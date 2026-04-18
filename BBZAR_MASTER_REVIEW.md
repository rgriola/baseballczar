# Baseball Czar 2.0 — Master Code Review

> **Review Date:** April 18, 2026  
> **Reviewer:** AI-assisted comprehensive audit  
> **Codebase Snapshot:** Next.js 14.2.35 / Supabase / TypeScript  

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
- 20 database tables, 18 API routes, 13 dashboard pages
- Full game simulation engine ported to TypeScript
- Player trading, free-agent market, training system, O2O challenges all functional
- Auth via Supabase (email/password) with RLS on all tables
- Some UI pages from the original are not yet implemented — these will be added over time

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, Server Components) |
| Language | TypeScript (strict mode) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password, SSR cookies) |
| Styling | Tailwind CSS |
| Validation | Zod v4 |
| Job Queue | BullMQ + ioredis (installed, not yet wired up) |
| Deployment | Vercel-compatible |

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
│   └── migrations/              # 3 migration files (schema, seed names, standings cols)
├── tests/                       # 2 smoke test scripts
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## Game Simulation Architecture

### How Games Were Simulated (Original v1 — Java/MAMP Era)

In the original 2010 build:
- **Game simulation ran as a separate Java process** with its own terminal window — you could watch game logs scroll in real time and monitor for issues
- **Training** ran as a scheduled daemon — once every 24 hours, it calculated skill improvements for all players across all leagues
- **Trades** had a daemon that processed the trade window — when the window closed, pending offers expired and completed trades finalized
- **The website (PHP/Apache)** was purely a front-end concern — it never ran simulation logic itself
- An entire 150-game season simulated in a couple of minutes because the Java engine ran natively, used batch SQL, and was decoupled from the web server

### How Games Are Simulated Now (v2 — Next.js)

The current architecture runs **everything inside the Next.js process** via API routes:

```
User clicks "Simulate Full Season"
       │
       ▼
POST /api/sim/sim-all  (Next.js API route)
       │
       ▼
┌──────────────────────────────────┐
│  For each unplayed game (sequential):       │
│                                              │
│  1. Load schedule entry from DB              │
│  2. Load both team rosters (4 queries)       │
│  3. Run pure-TypeScript engine (~5ms)        │
│  4. Persist results (9-step pipeline):       │
│     ├─ Insert game record                    │
│     ├─ Batch insert events (300+ rows)       │
│     ├─ Insert per-player hitting stats       │
│     ├─ Insert per-player pitching stats      │
│     ├─ Upsert season hitting stats  ← N+1!  │
│     ├─ Upsert season pitching stats ← N+1!  │
│     ├─ Update standings                      │
│     ├─ Mark schedule as played               │
│     └─ Process revenue (financial txns)      │
│  5. Sleep 200ms every 5 games                │
│                                              │
│  Total: ~147 games × 1.5 sec = 220+ seconds │
└──────────────────────────────────────────────┘
```

### Why It Feels Slow

| Factor | Impact |
|--------|--------|
| **Sequential processing** | Games simulated one-at-a-time in a single-threaded loop. No parallelism. |
| **N+1 query pattern** | Season stats upsert does individual SELECT + UPDATE per player per game (~28 queries/game × 147 games = **~4,100 queries** per season) |
| **Artificial sleep** | 200ms delay injected every 5 games (adds ~6 seconds to full season) |
| **No progress feedback** | Unlike the old Java terminal, the current system provides zero visibility — no logs, no progress bar, no streaming updates |
| **5-minute API timeout** | On Vercel, API routes time out at 5 minutes. A 147-game season at ~1.5s/game risks hitting this limit |
| **In-process execution** | The sim blocks the Next.js server while running — the website itself may feel sluggish during simulation |

### What Needs to Change

The game engine itself (the pure TypeScript in `src/lib/sim-engine/`) is fast — a single game resolves in ~5ms. The bottleneck is **orchestration and persistence**. The path forward:

1. **BullMQ worker process** — The dependency is already installed (`bullmq` + `ioredis`). Wire up a separate Node.js worker that pulls sim jobs from a Redis queue, runs them with full console logging, and reports progress. This restores the "separate terminal with visible logs" experience from v1.

2. **Batch SQL operations** — Replace the N+1 season stats upsert with `ON CONFLICT ... DO UPDATE` bulk upserts. This alone could cut per-game persistence time by 60-70%.

3. **Parallel game simulation** — Games within the same round are independent (different teams). They can be simulated concurrently.

4. **Training & Trade daemons** — Currently these are manual API calls. BullMQ cron jobs can replicate the original 24-hour training daemon and trade-window processor.

### Simulation Engine Internals (Quick Reference)

| Component | File | Purpose |
|-----------|------|---------|
| Entry point | `simulateScheduledGame()` | Load rosters, call engine, persist |
| Main loop | `GameEngine.ts` | Inning-by-inning, top/bottom half, walk-off detection |
| At-bat resolution | `AtBat.ts` | RNG roll against skill-derived probability thresholds |
| Skill math | `PlayerSkills.ts` | Converts 1-10 attributes to hit/walk/HR/K probabilities |
| Pitcher fatigue | `PlayerSkills.ts` | Stamina decay after batters-faced threshold |
| Baserunning | `Field.ts` | State machine: runner positions, advancement, scoring |
| Revenue | `GateReceipts.ts` | Gate receipts, food/bev, ads, stadium ops per game type |

---

## Review Summary & Severity Matrix

| Area | Severity | Key Finding | File |
|------|----------|-------------|------|
| **Security** | 🔴 CRITICAL | 4 sim API routes have zero authentication | [02-security.md](review/02-security.md) |
| **Performance** | 🔴 CRITICAL | N+1 queries: ~4,100 per season; sequential sim; no worker process | [06-performance.md](review/06-performance.md) |
| **Data Integrity** | 🟠 HIGH | Budget race conditions; missing CHECK constraints; standings unique key bug | [04-data-integrity.md](review/04-data-integrity.md) |
| **Error Handling** | 🟠 HIGH | No transaction wrapping on game persistence; no structured logging | [05-error-handling.md](review/05-error-handling.md) |
| **Architecture** | 🟠 HIGH | Sim runs in-process instead of worker; no daemon equivalents | [03-architecture-design.md](review/03-architecture-design.md) |
| **Testing** | 🟠 HIGH | Only 2 smoke tests; no unit/integration/E2E framework | [08-testing.md](review/08-testing.md) |
| **Correctness** | 🟡 MEDIUM | At-bat winner-take-all; pitcher re-selection bug; skill range issues | [01-correctness-logic.md](review/01-correctness-logic.md) |
| **Readability** | 🟢 LOW | Clean conventions; magic numbers in skill math; small name pool | [07-readability-maintainability.md](review/07-readability-maintainability.md) |

**Prioritized Improvement Plan:** [09-improvement-plan.md](review/09-improvement-plan.md)

---

## Detailed Review Files

| # | Review Area | File |
|---|-------------|------|
| 1 | Correctness & Logic | [review/01-correctness-logic.md](review/01-correctness-logic.md) |
| 2 | Security | [review/02-security.md](review/02-security.md) |
| 3 | Architecture & Design (incl. Game Sim) | [review/03-architecture-design.md](review/03-architecture-design.md) |
| 4 | Data Integrity | [review/04-data-integrity.md](review/04-data-integrity.md) |
| 5 | Error Handling | [review/05-error-handling.md](review/05-error-handling.md) |
| 6 | Performance | [review/06-performance.md](review/06-performance.md) |
| 7 | Readability & Maintainability | [review/07-readability-maintainability.md](review/07-readability-maintainability.md) |
| 8 | Testing | [review/08-testing.md](review/08-testing.md) |
| 9 | Improvement Plan | [review/09-improvement-plan.md](review/09-improvement-plan.md) |
