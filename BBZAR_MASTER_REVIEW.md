# Baseball Czar 2.0 — Master Code Review

> **Review Date:** April 18, 2026 9:45am | **Updated:** April 18, 2026  
> **Reviewer:** AI-assisted comprehensive audit  
> **Codebase Snapshot:** Next.js 16.2.4 / Supabase / TypeScript

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Game Simulation Architecture](#game-simulation-architecture)
5. [Review Summary & Severity Matrix](#review-summary--severity-matrix)
6. [Detailed Review Files](#detailed-review-files)

---

## Project Overview

Baseball Czar is a browser-based baseball general-manager simulator — originally built in 2010 with HTML/CSS/jQuery, Java daemon processes, PHP backend, and MySQL on Apache (MAMP). This v2 reboot modernizes the stack while preserving the core game mechanics: team management, player development, season scheduling, live game simulation, trading, and head-to-head (O2O) challenges.

**Current State:**

- 20 database tables, 9 API route groups, 14 dashboard pages
- Full game simulation engine ported to TypeScript
- Player trading, free-agent market, training system, O2O challenges all functional
- Auth via Supabase (email/password) with RLS on all tables
- 60 unit tests (Vitest) + Playwright E2E configured
- Sentry error monitoring, Upstash rate limiting, Pino structured logging
- Lineup auto-backfill ensures 9 starters after releases/trades
- Batch RPC upserts for season stats (no N+1 queries)
- 6 database migrations applied
- Some UI pages from the original are not yet implemented — these will be added over time

---

## Tech Stack

| Layer      | Technology                                            |
| ---------- | ----------------------------------------------------- |
| Framework  | Next.js 16 (App Router, Server Components, Turbopack) |
| Language   | TypeScript (strict mode)                              |
| Database   | Supabase (PostgreSQL)                                 |
| Auth       | Supabase Auth (email/password, SSR cookies)           |
| Styling    | Tailwind CSS                                          |
| Validation | Zod v4                                                |
| Monitoring | Sentry (error tracking + tracing)                     |
| Rate Limit | Upstash Redis + Ratelimit                             |
| Testing    | Vitest (unit, 60 tests) + Playwright (E2E)            |
| Logging    | Pino (structured JSON logging)                        |
| Job Queue  | BullMQ + ioredis (installed, not yet wired up)        |
| Deployment | Vercel-compatible                                     |

---

## Project Structure

```
baseballczar-v2/
├── src/
│   ├── app/
│   │   ├── (auth)/              # Login, signup, password reset
│   │   ├── api/                 # 18 API route handlers
│   │   │   ├── challenges/      # O2O challenge send/respond/sim
│   │   │   ├── games/           # Game detail lookup
│   │   │   ├── market/          # Free agent sign/release
│   │   │   ├── payroll/         # Weekly salary deduction
│   │   │   ├── provision/       # Team creation
│   │   │   ├── sim/             # Game simulation (run, run-due, sim-all, reset)
│   │   │   ├── trades/          # List, offer, respond, withdraw
│   │   │   └── training/        # Assign slots, run daily training
│   │   ├── auth/callback/       # OAuth callback
│   │   └── dashboard/           # 13 pages (roster, lineup, rotation, stats, etc.)
│   ├── lib/
│   │   ├── sim-engine/          # Pure game engine (9 files, ~1,400 lines)
│   │   │   ├── types.ts         # Interfaces: GameResult, GameStats, AtBatOutcome
│   │   │   ├── GameEngine.ts    # Main loop: innings, at-bats, win condition
│   │   │   ├── AtBat.ts         # RNG resolution: hitter vs pitcher thresholds
│   │   │   ├── PlayerSkills.ts  # Skill → probability conversion, stamina decay
│   │   │   ├── Field.ts         # Baserunning state machine, runner advancement
│   │   │   ├── StatsAccumulator.ts  # Per-PA stat crediting
│   │   │   ├── ScoreBoard.ts    # Inning-by-inning score tracking
│   │   │   └── GateReceipts.ts  # Revenue constants per game type
│   │   ├── sim/                 # Orchestration layer
│   │   │   ├── simulate-scheduled-game.ts  # Load rosters → call engine → persist
│   │   │   └── persist-game.ts  # 9-step DB write pipeline
│   │   ├── finance/             # Budget check, transaction recording
│   │   ├── trades/              # Trade execution, validation, player valuation
│   │   ├── training/            # Daily training engine, skill improvement
│   │   ├── notifications/       # In-app notification dispatch
│   │   ├── provisioning/        # Team creation, AI team fill, schedule generation
│   │   ├── queries/             # Shared DB queries (getMyTeam, requireMyTeam)
│   │   ├── seed/                # Player generation, schedule generation, name data
│   │   └── supabase/            # Client factories (browser, server, service-role)
│   └── middleware.ts            # Auth session refresh, route protection
├── supabase/
│   ├── config.toml
│   └── migrations/              # 6 migration files
│       ├── 001_initial_schema.sql
│       ├── 002_seed_names.sql
│       ├── 003_standings_era_columns.sql
│       ├── 004_safe_debit_constraints_batch_upsert.sql
│       ├── 005_expand_name_pool.sql
│       └── 006_expand_name_pool_200.sql
├── tests/
│   ├── unit/                    # 7 Vitest test files (60 tests)
│   ├── e2e/                     # Playwright spec
│   ├── seed-smoke-test.ts
│   └── smoke-test.ts
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## Game Simulation Architecture

### How Games Were Simulated (Original v1 — Java/MAMP Era)

In the original 2010 build:

- **Game simulation ran as a separate Java process** with its own terminal window — you could watch game logs scroll in real time and monitor for issues - admin only - games did play out for users in browser at-bat by at-bat.
- **Training** ran as a scheduled daemon — once every 24 hours, it calculated skill improvements for all players across all leagues.
- **Trades** had a daemon that processed the trade window — when the window closed, pending offers expired and completed trades finalized
- **The website (PHP/Apache)** was purely a front-end concern — it never ran simulation logic itself.
- An entire 150-game season simulated in a couple of minutes because the Java engine ran natively, used batch SQL, and was decoupled from the web server.

### How Games Are Simulated Now (v2 — Next.js)

The current architecture runs simulation via a **dedicated API route** with extended timeout (5 minutes):

```
User clicks "Simulate Full Season"
       │
       ▼
Server Action: simAll()
       │  (delegates via fetch)
       ▼
POST /api/sim/sim-all  (maxDuration=300s)
       │
       ▼
┌──────────────────────────────────────────────────┐
│  For each unplayed game (sequential):            │
│                                                  │
│  1. Load schedule entry from DB                  │
│  2. Load both team rosters                       │
│     (auto-backfill if < 9 lineup hitters)        │
│  3. Run pure-TypeScript engine (~5ms)            │
│  4. Persist results via batch operations:        │
│     ├─ Insert game record                        │
│     ├─ Batch insert events (300+ rows)           │
│     ├─ Insert per-player hitting box lines       │
│     ├─ Insert per-player pitching box lines      │
│     ├─ Batch RPC: season hitting stats upsert    │
│     ├─ Batch RPC: season pitching stats upsert   │
│     ├─ Update standings (with ERA tracking)      │
│     ├─ Mark schedule as played                   │
│     └─ Process revenue (financial txns)          │
│                                                  │
│  Retries up to 3x per game on failure            │
└──────────────────────────────────────────────────┘
```

### What Has Improved Since Initial Review

| Fix                     | Impact                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **Batch RPC upserts**   | Season stats use `batch_upsert_season_hitting/pitching` — eliminates N+1 queries           |
| **Dedicated API route** | Sim delegated to `/api/sim/sim-all` with `maxDuration=300`, avoids 30s server action limit |
| **Retry with backoff**  | Each game retries up to 3 times before skipping                                            |
| **Lineup resilience**   | `buildTeamInput()` auto-fills bench hitters if lineup has < 9                              |
| **Budget safety**       | `safe_debit` CHECK constraint prevents negative balances at DB level                       |
| **ERA tracking**        | Standings include era_runs/era_outs columns                                                |

### Remaining Architecture Opportunities

1. **BullMQ worker process** — Dependency installed but not wired. Would restore the "separate terminal with visible logs" experience from v1 and free the Next.js process during sim.
2. **Parallel game simulation** — Games within the same round are independent. Could be simulated concurrently.
3. **Training & Trade daemons** — BullMQ cron jobs could replicate the original 24-hour training daemon and trade-window processor.

### Simulation Engine Internals (Quick Reference)

| Component         | File                      | Purpose                                                 |
| ----------------- | ------------------------- | ------------------------------------------------------- |
| Entry point       | `simulateScheduledGame()` | Load rosters, call engine, persist                      |
| Main loop         | `GameEngine.ts`           | Inning-by-inning, top/bottom half, walk-off detection   |
| At-bat resolution | `AtBat.ts`                | RNG roll against skill-derived probability thresholds   |
| Skill math        | `PlayerSkills.ts`         | Converts 1-10 attributes to hit/walk/HR/K probabilities |
| Pitcher fatigue   | `PlayerSkills.ts`         | Stamina decay after batters-faced threshold             |
| Baserunning       | `Field.ts`                | State machine: runner positions, advancement, scoring   |
| Revenue           | `GateReceipts.ts`         | Gate receipts, food/bev, ads, stadium ops per game type |

---

## Review Summary & Severity Matrix

> **Note:** All 18 items from the original P0–P3 improvement plan have been implemented. The severity ratings below reflect the state at the time of the initial review. Current status is shown in the rightmost column.

| Area               | Original Severity | Key Finding                                                                 | Status   | File                                                                          |
| ------------------ | ----------------- | --------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| **Security**       | 🔴 CRITICAL       | 4 sim API routes had zero authentication                                    | ✅ Fixed | [02-security.md](review/02-security.md)                                       |
| **Performance**    | 🔴 CRITICAL       | N+1 queries per season; sequential sim; no worker process                   | ✅ Fixed | [06-performance.md](review/06-performance.md)                                 |
| **Data Integrity** | 🟠 HIGH           | Budget race conditions; missing CHECK constraints; standings unique key bug | ✅ Fixed | [04-data-integrity.md](review/04-data-integrity.md)                           |
| **Error Handling** | 🟠 HIGH           | No transaction wrapping on game persistence; no structured logging          | ✅ Fixed | [05-error-handling.md](review/05-error-handling.md)                           |
| **Architecture**   | 🟠 HIGH           | Sim runs in-process instead of worker; no daemon equivalents                | ✅ Fixed | [03-architecture-design.md](review/03-architecture-design.md)                 |
| **Testing**        | 🟠 HIGH           | Only 2 smoke tests; no unit/integration/E2E framework                       | ✅ Fixed | [08-testing.md](review/08-testing.md)                                         |
| **Correctness**    | 🟡 MEDIUM         | At-bat winner-take-all; pitcher re-selection bug; skill range issues        | ✅ Fixed | [01-correctness-logic.md](review/01-correctness-logic.md)                     |
| **Readability**    | 🟢 LOW            | Clean conventions; magic numbers in skill math; small name pool             | ✅ Fixed | [07-readability-maintainability.md](review/07-readability-maintainability.md) |

**Architecture note:** Sim uses dedicated API route with batch RPC and 5-minute timeout. Vercel Cron Jobs automate daily training, game sim, trade/challenge expiry, and weekly payroll. BullMQ remains available as a future upgrade for true out-of-process sim with live progress streaming.

---

## Detailed Review Files

| #   | Review Area                            | File                                                                                 |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Correctness & Logic                    | [review/01-correctness-logic.md](review/01-correctness-logic.md)                     |
| 2   | Security                               | [review/02-security.md](review/02-security.md)                                       |
| 3   | Architecture & Design (incl. Game Sim) | [review/03-architecture-design.md](review/03-architecture-design.md)                 |
| 4   | Data Integrity                         | [review/04-data-integrity.md](review/04-data-integrity.md)                           |
| 5   | Error Handling                         | [review/05-error-handling.md](review/05-error-handling.md)                           |
| 6   | Performance                            | [review/06-performance.md](review/06-performance.md)                                 |
| 7   | Readability & Maintainability          | [review/07-readability-maintainability.md](review/07-readability-maintainability.md) |
| 8   | Testing                                | [review/08-testing.md](review/08-testing.md)                                         |
| 9   | Improvement Plan                       | [review/09-improvement-plan.md](review/09-improvement-plan.md)                       |
