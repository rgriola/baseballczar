# Review: Architecture & Design

> **Review Date:** April 18, 2026 | **Updated:** April 18, 2026  
> **Scope:** Overall architecture, component design, game simulation system, daemon equivalents

---

## Summary

The application follows clean Next.js App Router conventions with a well-separated game engine. The original review identified that all heavy processing ran inside the web server with no automation. Since then:

- **Game simulation** now delegates to a dedicated API route with 5-minute timeout, batch RPC upserts, and per-game retry logic
- **Daemon equivalents** are implemented via **Vercel Cron Jobs**: daily cron handles game sim + training + trade/challenge expiry; weekly cron handles payroll
- **Remaining opportunity:** BullMQ worker process for true out-of-process sim with live progress streaming

---

## Overall Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Dashboard │  │  Auth    │  │  Client Components   │  │
│  │  Pages    │  │  Pages   │  │  (LineupEditor, etc) │  │
│  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘  │
└───────┼──────────────┼───────────────────┼──────────────┘
        │              │                   │
        │    Server Actions (form submits) │
        │              │                   │
┌───────┼──────────────┼───────────────────┼──────────────┐
│       ▼              ▼                   ▼              │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Next.js Server (App Router)            │   │
│  │                                                   │   │
│  │  /app/dashboard/*   → Server Components (RSC)    │   │
│  │  /app/api/*         → API Route Handlers          │   │
│  │  /app/(auth)/*      → Auth pages + actions        │   │
│  │  proxy.ts            → Session refresh + guards    │   │
│  └───────────────────────┬───────────────────────────┘   │
│                          │                               │
│  ┌───────────────────────┼───────────────────────────┐   │
│  │              /lib/ (Business Logic)                │   │
│  │                       │                            │   │
│  │  sim-engine/  ← Pure game engine (no DB)          │   │
│  │  sim/         ← Orchestration (load → sim → save) │   │
│  │  trades/      ← Trade execution + valuation       │   │
│  │  training/    ← Daily skill improvement           │   │
│  │  finance/     ← Budget operations                 │   │
│  │  notifications/ ← In-app alerts                   │   │
│  │  provisioning/  ← Team creation + AI fill         │   │
│  └───────────────────────┬───────────────────────────┘   │
│                          │                               │
│                     Supabase Client                      │
└──────────────────────────┼───────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Supabase   │
                    │ (Postgres)  │
                    │  + Auth     │
                    │  + RLS      │
                    └─────────────┘
```

### What Works Well

1. **Clean separation of concerns** — The `sim-engine/` directory contains pure TypeScript with zero database dependencies. It can be tested, profiled, and potentially run in a worker thread without any refactoring.

2. **Server Components by default** — Dashboard pages are server-rendered with client components only where interactivity is needed (lineup editor, rotation editor, roster toggle). This minimizes client JavaScript.

3. **Supabase client factories** — Three distinct client types (browser, server, service-role) with clear usage boundaries.

4. **Zod validation at API boundaries** — Every API route validates input with Zod schemas before touching the database.

5. **RLS on all tables** — Row-Level Security is enabled everywhere, with service-role used only for system operations.

---

## Findings

### 1. Game Simulation Runs In-Process (No Worker)

**Severity:** 🟠 HIGH → ✅ **Mitigated**  
**Files:** `src/app/api/sim/sim-all/route.ts`, `src/app/api/sim/run-due/route.ts`, `src/app/api/cron/daily/route.ts`

**Original Issue:** The sim ran inside a 30-second server action, blocked the web server, and had zero visibility.

**What Changed:**

- `simAll()` server action now delegates to `POST /api/sim/sim-all` via fetch
- `sim-all` route has `maxDuration=300` (5-minute Vercel timeout)
- Each game retries up to 3 times with exponential backoff
- Batch RPC upserts (`batch_upsert_season_hitting/pitching`) eliminated N+1 queries
- `buildTeamInput()` auto-fills bench hitters if lineup has < 9
- Vercel Cron calls `/api/cron/daily` at 4 AM UTC to auto-sim due games
- Pino structured logging captures sim progress

**Still Open:** BullMQ worker process would enable true background execution with live progress streaming. The dependencies are installed (`bullmq`, `ioredis`) but not wired.

**Future Architecture (optional):**

```
┌─────────────┐     POST /api/sim/enqueue      ┌──────────────┐
│  Dashboard   │ ──────────────────────────────▶│  Next.js API  │
│  (Browser)   │                                │  (Enqueue Job)│
└──────┬──────┘                                └───────┬──────┘
       │                                               │
       │  SSE or polling for progress                  │ Redis queue
       │                                               ▼
       │                                      ┌──────────────┐
       │◀─────── progress updates ────────────│  BullMQ       │
       │                                      │  Worker       │
       │                                      │  (separate    │
       │                                      │   process)    │
       │                                      │              │
       │                                      │  ✓ Own logs  │
       │                                      │  ✓ Progress  │
       │                                      │  ✓ Retry     │
       │                                      │  ✓ No timeout│
       │                                      └──────────────┘
```

---

### 2. No Daemon Equivalents for Training & Trades

**Severity:** 🟠 HIGH → ✅ **Resolved**  
**Files:** `src/app/api/cron/daily/route.ts`, `src/app/api/cron/weekly/route.ts`, `vercel.json`

**Original Issue:** Training, payroll, and trade expiry only ran via manual API calls.

**What Changed — Vercel Cron Jobs:**

| Schedule        | Route                  | What It Does                                                       |
| --------------- | ---------------------- | ------------------------------------------------------------------ |
| Daily 4 AM UTC  | `GET /api/cron/daily`  | Sim due games, run training, expire stale trades/challenges (>48h) |
| Monday 5 AM UTC | `GET /api/cron/weekly` | Deduct weekly payroll from all team budgets                        |

**Configuration** (`vercel.json`):

```json
{
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 4 * * *" },
    { "path": "/api/cron/weekly", "schedule": "0 5 * * 1" }
  ]
}
```

**Security:** Both cron routes are protected by `CRON_SECRET` Bearer token (Vercel automatically sends this header for cron invocations).

**What each daily cron run does:**

1. **Game sim** — Fetches all unplayed games with `game_time <= now`, simulates them sequentially
2. **Training** — Calls `runDailyTraining()` for all players with assigned training slots
3. **Trade/challenge expiry** — Sets `status='withdrawn'` on trade offers pending >48h, `status='expired'` on stale challenge requests

The manual API routes (`POST /api/training/run`, `POST /api/payroll/run`) still work for admin/testing purposes.

---

### 3. Repeated Auth Boilerplate in API Routes

**Severity:** 🟡 MEDIUM  
**Scope:** All 14 authenticated API routes

**Issue:** Every authenticated API route repeats the same 10-line auth block:

```typescript
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();
if (!user)
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

const { data: team } = await supabase
  .from("teams")
  .select("id")
  .eq("owner_id", user.id)
  .single();
if (!team)
  return NextResponse.json({ error: "No team found" }, { status: 404 });
```

And Bearer-token routes repeat:

```typescript
const authHeader = request.headers.get("authorization");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

**Impact:** Code duplication increases the risk of inconsistency (e.g., the sim routes forgot to add auth).

**Recommendation:** Create shared middleware helpers:

```typescript
// lib/api/auth.ts
export async function requireUser(request: Request) { ... }
export async function requireTeamOwner(request: Request) { ... }
export async function requireServiceKey(request: Request) { ... }
```

---

### 4. Provisioning Auto-Fill Creates Full League on 6th Team

**Severity:** 🟡 MEDIUM  
**File:** `src/lib/provisioning/provision-team.ts`

**Issue:** When the 6th team joins a league, the system auto-fills remaining slots with AI teams, generates 40 players per AI team, creates standings, budgets, and generates the full 150-game schedule. This is a massive operation (~200+ database inserts) triggered by a single user action (team creation).

**Impact:**

- The provisioning request takes 10-30 seconds to complete
- If it fails mid-way, the league is in a partially-created state
- No transaction wrapping — partial AI teams or schedules could exist

**Recommendation:**

- Move league-fill and schedule generation to a BullMQ job
- Return immediately to the user with "League is being set up..."
- Notify via in-app notification when ready

---

### 5. No API Versioning

**Severity:** 🟢 LOW  
**Scope:** All API routes

**Issue:** All routes are at `/api/...` with no version prefix. If the API contract changes (e.g., different request/response format), existing clients break.

**Recommendation:** Not urgent for a single-frontend app, but worth considering `/api/v1/...` if the API will be consumed by external tools or a future mobile app.

---

## Game Simulation Deep Dive

### Engine Architecture (9 Files)

```
sim-engine/
├── types.ts           ← All interfaces (PlayerSkills, GameResult, GameStats, AtBatOutcome enum)
├── GameEngine.ts      ← Main simulation loop
│   └── simulateGame(visitor, home) → GameResult
│       ├── Inning loop (do/while until win condition)
│       ├── Top half: visitor bats, home pitches
│       ├── Bottom half: home bats, visitor pitches
│       ├── Walk-off detection (9th+ inning)
│       └── Win/loss finalization
├── AtBat.ts           ← Single at-bat resolution
│   └── resolveAtBat(hitterThresholds, pitcherThresholds) → outcome + roll
├── PlayerSkills.ts    ← Skill-to-probability conversion
│   ├── calculateHitterSkill(skills) → cumulative thresholds [S, D, T, HR, BB, K, GO]
│   ├── calculatePitcherSkill(skills, bf) → same thresholds, with stamina decay
│   └── applyStaminaDecay(skills, battersFaced) → degraded skills
├── Field.ts           ← Baserunning state machine
│   ├── runners[0-6]: batter, 1B, 2B, 3B, scoring slots
│   ├── baseSequence(outcome) → play descriptions
│   └── Runner advancement rules per outcome type
├── StatsAccumulator.ts ← Helper functions
│   ├── addHitterPA(), addPitcherPA(), addTeamHittingStats()
│   ├── createGameStats(), createPitcherBoxLine()
│   └── creditRuns(), addPitcherER(), addHitterRun()
├── ScoreBoard.ts      ← Inning-by-inning tracking (max 35 innings)
├── GateReceipts.ts    ← Revenue constants
│   ├── Regular: home $22,500, visitor $15,000
│   ├── Playoff: home $35,000, visitor $25,000
│   └── Food/bev 15%, ads 8%, stadium ops -$5,000
└── index.ts           ← Public exports
```

### Data Flow: One Game

```
1. Load Schedule    SELECT * FROM schedules WHERE id=X AND played=false
        │
2. Load Teams      SELECT id, team_name FROM teams WHERE id IN (home, visitor)
        │
3. Load Rosters    SELECT hitters (9, active, ordered by batt_order)
   (4 queries)     SELECT pitchers (active, rotation_slot > 0, ordered)
                   × 2 teams
        │
4. Simulate        simulateGame(visitor, home)  ← Pure TypeScript, ~5ms
        │           Returns: GameResult with:
        │           - Final score, innings, winner/loser
        │           - events[] (300+ play-by-play entries)
        │           - homePlayerStats / visitorPlayerStats (Map<id, GameStats>)
        │           - homePitcherStats / visitorPitcherStats (Map<id, PitcherBoxLine>)
        │
5. Persist         9-step pipeline (see Performance review for details):
   (~1.5 sec)      game → events → hitting stats → pitching stats →
                   season hitting → season pitching → standings →
                   mark played → revenue
```

### Key Design Decisions in the Engine

| Decision                             | Rationale                                  | Tradeoff                                       |
| ------------------------------------ | ------------------------------------------ | ---------------------------------------------- |
| Pure TypeScript, no DB               | Engine can be unit-tested without database | Requires separate orchestration layer          |
| Single random roll per at-bat        | Simple, fast                               | Less realistic than pitch-by-pitch sim         |
| Dominance-based threshold            | Prevents "average of averages" problem     | Creates cliff-effects (see Correctness review) |
| Pitcher fatigue by BF count          | Simple tracking, no pitch count            | Less granular than real baseball               |
| Fixed bullpen order by rotation_slot | Predictable                                | No in-game strategy adjustments                |
| Baserunning as state machine         | Clear rules, deterministic per outcome     | Simplified (no stolen bases during at-bats)    |

### What the Original Java System Did Differently

| Feature          | Java v1                                  | TypeScript v2 (current)                |
| ---------------- | ---------------------------------------- | -------------------------------------- |
| Process model    | Separate JVM process                     | Dedicated API route (maxDuration=300s) |
| Logging          | Own terminal with real-time output       | Pino structured JSON logging           |
| Progress         | Visible game-by-game in console          | Server-side logs (no UI streaming yet) |
| Error recovery   | Daemon restarts, picks up where left off | Per-game retry (3x) + skips on failure |
| Training         | 24-hour cron daemon                      | Vercel Cron daily at 4 AM UTC          |
| Trades           | Trade-window daemon with deadline logic  | Daily cron expires pending offers >48h |
| Payroll          | Scheduled weekly daemon                  | Vercel Cron weekly (Monday 5 AM UTC)   |
| Season sim speed | ~2 minutes for 150 games                 | ~2-3 minutes (batch RPC, no N+1)       |
| Connection model | Persistent JDBC connection pool          | Per-request Supabase client            |

---

## Summary Table

| #   | Finding                                           | Severity | Status       | Category          |
| --- | ------------------------------------------------- | -------- | ------------ | ----------------- |
| 1   | Game sim runs in-process, no worker               | HIGH     | ⚠️ Mitigated | Process Model     |
| 2   | No daemon equivalents (training, trades, payroll) | HIGH     | ✅ Resolved  | Automation        |
| 3   | Repeated auth boilerplate across API routes       | MEDIUM   | Open         | Code Organization |
| 4   | Provisioning does massive work synchronously      | MEDIUM   | Open         | User Experience   |
| 5   | No API versioning                                 | LOW      | Open         | API Design        |
