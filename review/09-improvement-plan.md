# Review: Prioritized Improvement Plan

> **Review Date:** April 18, 2026  
> **Scope:** Actionable roadmap synthesized from all review findings

---

## Priority Legend

| Priority | Meaning                                              | Timeline     |
| -------- | ---------------------------------------------------- | ------------ |
| **P0**   | Security / data corruption risk — fix before launch  | This week    |
| **P1**   | Core functionality / performance — fix before beta   | Next 2 weeks |
| **P2**   | Quality of life / infrastructure — build during beta | Weeks 3-6    |
| **P3**   | Nice to have — plan for v2.1                         | Backlog      |

---

## P0 — Critical (Fix Before Launch)

### P0-1: Authenticate the 4 Unprotected Sim API Routes

**Severity:** CRITICAL  
**Review:** [02-security.md](02-security.md) Finding #1  
**Files:** `src/app/api/sim/route.ts`, `src/app/api/sim/advance-day/route.ts`, `src/app/api/payroll/route.ts`, `src/app/api/provision/route.ts`

**What to do:**

1. Add `createClient()` + `supabase.auth.getUser()` check at the top of each route
2. For sim routes: verify the authenticated user owns the league, OR restrict to admin role
3. Return `401 Unauthorized` for missing/invalid auth
4. Return `403 Forbidden` for valid auth but no ownership

**Effort:** ~2 hours  
**Risk if skipped:** Anyone with the URL can trigger game simulations, create teams, or process payroll for any league.

---

### P0-2: Wrap Budget Operations in Database Transactions

**Severity:** CRITICAL  
**Review:** [04-data-integrity.md](04-data-integrity.md) Finding #1  
**File:** `src/lib/finance/budget.ts`

**What to do:**

1. Replace the check-then-update pattern with a Supabase RPC function:

```sql
CREATE OR REPLACE FUNCTION safe_debit(p_team_id UUID, p_amount INT, p_description TEXT)
RETURNS BOOLEAN AS $$
DECLARE v_balance INT;
BEGIN
  SELECT budget INTO v_balance FROM teams WHERE id = p_team_id FOR UPDATE;
  IF v_balance < p_amount THEN RETURN FALSE; END IF;
  UPDATE teams SET budget = budget - p_amount WHERE id = p_team_id;
  INSERT INTO transactions (team_id, amount, description) VALUES (p_team_id, -p_amount, p_description);
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

2. Call from TypeScript: `supabase.rpc('safe_debit', { p_team_id, p_amount, p_description })`
3. Apply to: market signing, trade cash transfers, payroll processing

**Effort:** ~4 hours  
**Risk if skipped:** Two concurrent signings can overdraw a team's budget, creating negative balances.

---

### P0-3: Add Rate Limiting to Public-Facing Routes

**Severity:** HIGH  
**Review:** [02-security.md](02-security.md) Finding #4  
**Scope:** All API routes, especially auth

**What to do:**

1. Install `@upstash/ratelimit` + `@upstash/redis` (or use Vercel KV)
2. Add middleware-level rate limiting:
   - Auth routes: 5 requests/minute per IP
   - API routes: 30 requests/minute per user
   - Sim routes: 1 request/10 seconds per user (simulations are expensive)
3. Return `429 Too Many Requests` with `Retry-After` header

**Effort:** ~3 hours  
**Risk if skipped:** A single user could trigger thousands of simulations, consuming all server resources.

---

## P1 — High Priority (Fix Before Beta)

### P1-1: Implement BullMQ Background Worker

**Severity:** HIGH  
**Review:** [03-architecture-design.md](03-architecture-design.md) Finding #1  
**Files:** New `src/worker/` directory, `src/app/api/sim/route.ts`

**What to do:**

1. Create `src/worker/sim-worker.ts` — a standalone Node process
2. Wire up the already-installed `bullmq` + `ioredis` packages
3. API route: `POST /api/sim` → enqueue job → return `{ jobId }` immediately
4. Worker: pick up job → simulate games → persist results
5. Progress endpoint: `GET /api/sim/status/:jobId` → return job progress
6. Dashboard: poll for progress, show live updates

**Architecture:**

```
Browser → API (enqueue) → Redis Queue → Worker (simulate) → Supabase
                                                    ↓
Browser ← SSE/polling ← API (status) ← Redis (progress)
```

**Effort:** ~8-12 hours  
**Risk if skipped:** Simulating a full season blocks the HTTP response for 30+ seconds, risking Vercel timeouts and poor UX.

---

### P1-2: Fix N+1 Query Pattern in Game Persistence

**Severity:** HIGH  
**Review:** [06-performance.md](06-performance.md) Finding #1  
**File:** `src/lib/sim/persist-game.ts`

**What to do:**

1. Replace the per-player season stats loop with a batch upsert RPC:

```sql
CREATE OR REPLACE FUNCTION batch_upsert_season_stats(p_stats JSONB)
RETURNS VOID AS $$
BEGIN
  INSERT INTO season_batting_stats (player_id, season, team_id, g, ab, h, ...)
  SELECT * FROM jsonb_populate_recordset(NULL::season_batting_stats, p_stats)
  ON CONFLICT (player_id, season) DO UPDATE SET
    g = season_batting_stats.g + EXCLUDED.g,
    ab = season_batting_stats.ab + EXCLUDED.ab,
    h = season_batting_stats.h + EXCLUDED.h;
END;
$$ LANGUAGE plpgsql;
```

2. Collect all hitter/pitcher stats into arrays
3. Call the RPC once per game instead of once per player

**Impact:** Reduces queries per game from ~28 to ~5. Over a 155-game season × 3 games/day: from ~4,100 queries to ~750.

**Effort:** ~4-6 hours

---

### P1-3: Add Missing Database Constraints

**Severity:** HIGH  
**Review:** [04-data-integrity.md](04-data-integrity.md) Finding #3  
**File:** New migration `supabase/migrations/004_add_constraints.sql`

**What to do:**

```sql
-- Prevent negative budgets
ALTER TABLE teams ADD CONSTRAINT budget_non_negative CHECK (budget >= 0);

-- Prevent negative stats
ALTER TABLE season_batting_stats ADD CONSTRAINT games_non_negative CHECK (g >= 0);
ALTER TABLE season_batting_stats ADD CONSTRAINT abs_non_negative CHECK (ab >= 0);
ALTER TABLE season_pitching_stats ADD CONSTRAINT wins_non_negative CHECK (w >= 0);
ALTER TABLE season_pitching_stats ADD CONSTRAINT era_non_negative CHECK (era >= 0);

-- Prevent duplicate standings entries
ALTER TABLE standings ADD CONSTRAINT unique_team_season
  UNIQUE (team_id, season);

-- Skill ranges
ALTER TABLE hitters ADD CONSTRAINT hitter_speed_range CHECK (speed BETWEEN 1 AND 100);
ALTER TABLE hitters ADD CONSTRAINT hitter_eye_range CHECK (eye BETWEEN 1 AND 100);
-- (similar for all skill columns)
```

**Effort:** ~2-3 hours  
**Risk if skipped:** Bad data can accumulate silently — negative budgets, duplicate standings rows, stats exceeding logical bounds.

---

### P1-4: Fix Standings Duplicate-on-Re-Sim

**Severity:** MEDIUM  
**Review:** [01-correctness-logic.md](01-correctness-logic.md) Finding #3  
**File:** `src/lib/sim/persist-game.ts`

**What to do:**

1. Change standings upsert from `INSERT ... increment` to `UPSERT`:

```typescript
const { error } = await supabase
  .from("standings")
  .upsert(
    { team_id: winnerId, season, wins: 1, losses: 0 },
    { onConflict: "team_id,season", ignoreDuplicates: false },
  );
```

2. Or use an RPC function that does `INSERT ... ON CONFLICT DO UPDATE`
3. Add the `UNIQUE (team_id, season)` constraint from P1-3

**Effort:** ~2 hours

---

## P2 — Medium Priority (During Beta)

### P2-1: Install Vitest + Write Core Unit Tests

**Review:** [08-testing.md](08-testing.md) Findings #1-3

**What to do:**

1. `npm install -D vitest @vitest/coverage-v8`
2. Add `vitest.config.ts` with path aliases matching `tsconfig.json`
3. Write tests for:
   - `sim-engine/AtBat.ts` — threshold boundary tests
   - `sim-engine/PlayerSkills.ts` — skill calculation tests
   - `sim-engine/Field.ts` — baserunning state machine tests
   - `sim-engine/GameEngine.ts` — full game integration test
   - `lib/finance/budget.ts` — calculation logic
4. Target: 80% coverage on `sim-engine/` directory

**Effort:** ~15-20 hours

---

### P2-2: Add Structured Logging

**Review:** [05-error-handling.md](05-error-handling.md) Finding #3

**What to do:**

1. Install `pino` (lightweight structured logger)
2. Create `src/lib/logger.ts` with child loggers per domain
3. Replace `console.log` calls with structured log calls
4. Log: sim start/end, game results, trade executions, errors with context
5. Add request-id tracking via middleware

**Effort:** ~4-6 hours

---

### P2-3: Add Cron-Based Auto-Simulation

**Review:** [03-architecture-design.md](03-architecture-design.md) Finding #2

**What to do:**

1. Add Vercel Cron or `node-cron` to auto-advance the sim day
2. Schedule: `0 */4 * * *` (every 4 hours) or configurable
3. Sim all scheduled games for the current day
4. Advance the league calendar
5. Process payroll on appropriate days

**Effort:** ~4 hours (depends on P1-1 being done first)

---

### P2-4: Add Security Headers via Middleware

**Review:** [02-security.md](02-security.md) Finding #5

**What to do:**
Add to `src/middleware.ts`:

```typescript
const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...",
};
```

**Effort:** ~1-2 hours

---

### P2-5: Extract Magic Numbers to Named Constants

**Review:** [07-readability-maintainability.md](07-readability-maintainability.md) Finding #1

**What to do:**

1. Create `src/lib/sim-engine/constants.ts`
2. Move all skill coefficients, fatigue thresholds, and game parameters to named constants
3. Add JSDoc explaining what each constant controls
4. Benefit: easier to tune game balance without reading formulas

**Effort:** ~2-3 hours

---

## P3 — Backlog (v2.1)

### P3-1: E2E Tests with Playwright

**Review:** [08-testing.md](08-testing.md) Finding #6

- Install Playwright
- 5 critical-path tests (signup, roster, lineup, sim, results)
- Run in CI/CD pipeline

**Effort:** ~10-15 hours

---

### P3-2: CI/CD Pipeline

**Review:** [08-testing.md](08-testing.md) Finding #7

- GitHub Actions: lint → build → test → deploy
- Coverage reporting (Codecov or similar)
- Branch protection: no merge without passing checks

**Effort:** ~4-6 hours

---

### P3-3: Error Monitoring (Sentry)

**Review:** [05-error-handling.md](05-error-handling.md) Finding #5

- Install `@sentry/nextjs`
- Configure error boundaries
- Alert on unhandled exceptions
- Performance monitoring for API routes

**Effort:** ~2-3 hours

---

### P3-4: Response Caching

**Review:** [06-performance.md](06-performance.md) Finding #3

- Add `Cache-Control` headers to stable data (standings, stats after sim day ends)
- Consider ISR (Incremental Static Regeneration) for public league pages
- Redis cache for frequently-read queries (standings, leaders)

**Effort:** ~4-6 hours

---

### P3-5: Expand Name Pool

**Review:** [07-readability-maintainability.md](07-readability-maintainability.md) Finding #3

- Expand from 43 to 200+ first/last names
- Remove duplicate data source (SQL migration vs TypeScript file)
- Consider: baseball-themed names, era-appropriate names

**Effort:** ~2 hours

---

### P3-6: Split persist-game.ts Into Focused Modules

**Review:** [07-readability-maintainability.md](07-readability-maintainability.md) Finding #2

- `persist-game-record.ts` — game + events
- `persist-player-stats.ts` — game + season stats
- `persist-standings.ts` — standings + schedule
- `persist-revenue.ts` — financial transactions

**Effort:** ~3-4 hours

---

## Implementation Order

```
Week 1:  P0-1 (auth) → P0-2 (transactions) → P0-3 (rate limiting)
Week 2:  P1-3 (constraints) → P1-4 (standings fix) → P1-2 (N+1 queries)
Week 3:  P1-1 (BullMQ worker) — largest single task
Week 4:  P2-1 (Vitest + core tests)
Week 5:  P2-2 (logging) + P2-4 (security headers) + P2-5 (constants)
Week 6:  P2-3 (cron) + cleanup
Ongoing: P3 items as time allows
```

---

## Effort Summary

| Priority  | Items        | Total Effort      |
| --------- | ------------ | ----------------- |
| P0        | 3 items      | ~9 hours          |
| P1        | 4 items      | ~18-25 hours      |
| P2        | 5 items      | ~27-37 hours      |
| P3        | 6 items      | ~26-36 hours      |
| **Total** | **18 items** | **~80-107 hours** |

---

## Quick Wins (< 2 hours each)

These can be done immediately between larger tasks:

1. ✅ Auth on 4 sim routes (P0-1, partial — just the auth check)
2. ✅ Security headers in middleware (P2-4)
3. ✅ `UNIQUE` constraint on standings (P1-3, partial)
4. ✅ Extract skill constants (P2-5)
5. ✅ `npm install -D vitest` + one test file (P2-1, partial)
