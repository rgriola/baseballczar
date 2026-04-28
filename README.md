# Baseball Czar v2

A baseball management simulation game — draft players, set lineups, manage finances, and compete across a full season. Originally a Java desktop app with a separate simulation daemon, now rebuilt as a TypeScript monorepo targeting web and iOS.

## Monorepo Structure

```
baseballczar-v2/
├── apps/
│   ├── web/              # Next.js web app (@baseballczar/web)
│   └── ios/              # Expo React Native app (@baseballczar/ios)
├── packages/
│   └── sim-engine/       # Shared physics sim engine (@baseballczar/sim-engine)
├── package.json          # Workspace root (npm workspaces)
├── review/               # Code review documents
└── IOS_STRATEGY.md       # iOS product strategy and 5-phase build plan
```

## Tech Stack

### Web (`apps/web`)
- **Framework:** Next.js 16 (App Router, Server Components)
- **Database:** Supabase (PostgreSQL + Auth + Row Level Security)
- **Styling:** Tailwind CSS
- **Validation:** Zod v4
- **Monitoring:** Sentry
- **Rate Limiting:** Upstash Redis
- **Testing:** Vitest (unit) + Playwright (E2E)
- **Queue:** BullMQ + ioredis

### iOS (`apps/ios`)
- **Framework:** Expo + React Native
- **Renderer:** React Native Skia (2D field visualization)
- **Router:** Expo Router (file-based)

### Sim Engine (`packages/sim-engine`)
- **Language:** TypeScript (strict, no DOM deps)
- **RNG:** Seedable mulberry32 — fully reproducible
- **Physics:** Ball flight, park geometry, throw velocity (~85 mph), runner times (22–28 ft/sec)
- **Skill scale:** 1–10 across 9 attributes (avg, power, eye, speed, defense, stamina, pitchIntel, dhr, ag)
- **CONFIG_V1 baseline** (162 games, seed 1): BB% .085 | K% .251 | BABIP .322 | HR/FB .148 | R/G 4.08

## Prerequisites

- Node.js 20+
- npm 8+ (workspaces support)
- A [Supabase](https://supabase.com) project (free tier works)
- Supabase CLI for local development

## Getting Started

```bash
git clone https://github.com/rgriola/baseballczar.git
cd baseballczar-v2
npm install          # installs all workspaces
```

### Web app

```bash
# Create apps/web/.env.local with:
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SENTRY_DSN=your-sentry-dsn          # optional
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

npx supabase db push   # apply migrations
npm run dev            # → http://localhost:3000
```

### Sim engine (standalone)

```bash
npm run sim                              # 162-game season, random seed
npm run sim -- --games 10 --seed 42     # reproducible 10-game run
npm run sim -- --events out.json        # write game 1 event log
npm run skill-test                       # skill sensitivity harness
```

## Project Structure

### `packages/sim-engine/src/`

```
config.ts         # CONFIG_V1 — single source of truth for all tunable params
types.ts          # Player, Team, Skills, GameResult, AtBatRecord, …
rng.ts            # createRng(seed) — seedable mulberry32 PRNG
randomTeam.ts     # generateTeam(), generateMatchup()
agents.ts         # Pitcher + batter decision agents (2-strike foul boost)
atBat.ts          # Plate appearance resolution
battedBall.ts     # Physics-based batted ball outcome (exit velo, launch angle, distance)
game.ts           # Full game loop — half-innings, baserunner advancement, situational events
events.ts         # buildEvents() — derives SimEvent[] timeline from GameResult for 2D playback
report.ts         # aggregate() + formatReport() — rate-stat summary
manager.ts        # Lineup/rotation manager
index.ts          # Public entry point — all exports
physics/
  ballFlight.ts   # Drag + gravity ball flight model
  park.ts         # Park wall distances by spray angle
  speed.ts        # Runner speed model + base coordinates
  throw.ts        # Throw velocity and time model
```

### `apps/web/src/`

```
app/
├── (auth)/           # Login, signup, password reset
├── api/              # 9 API route groups
│   ├── challenges/   # O2O challenge send/respond/sim
│   ├── cron/         # Automated sim scheduling
│   ├── games/        # Game detail lookup
│   ├── market/       # Free agent sign/release
│   ├── payroll/      # Weekly salary deduction
│   ├── provision/    # Team creation + league fill
│   ├── sim/          # Game simulation (run, sim-all, status, reset)
│   ├── trades/       # List, offer, respond, withdraw
│   └── training/     # Assign slots, run daily training
├── auth/callback/    # Supabase OAuth callback
└── dashboard/        # 14 feature pages
    ├── roster/       # Team roster — 10 skills, Ht/Wt/Ctr, country flag
    ├── lineup/       # Batting order — position assignment, DH, B1/B2/B3 bench
    ├── rotation/     # Pitching rotation — SP1-5 + RP1-4
    ├── games/        # Game results and box scores
    ├── schedule/     # Season schedule
    ├── standings/    # League standings
    ├── leaders/      # Statistical leaders (10 categories)
    ├── stats/        # Detailed player statistics
    ├── finance/      # Budget and transaction history
    ├── market/       # Free agent signings
    ├── trades/       # Player trading system
    ├── training/     # Between-game skill development
    ├── challenges/   # One-on-one exhibition games
    └── notifications/# In-app notifications
lib/
├── sim-engine/       # Production sim engine (DB-wired, ~1,400 lines)
├── sim/              # DB orchestration — load rosters → engine → persist
├── finance/          # Safe debit/credit, transaction recording
├── lineup/           # Lineup backfill utility
├── trades/           # Trade proposal, execution, player valuation
├── training/         # Skill improvement system
├── notifications/    # In-app notification dispatch
├── provisioning/     # Team creation, AI fill, schedule generation
├── queries/          # Shared DB queries (getMyTeam, requireMyTeam)
├── seed/             # Player generation, schedule generation, 200+ names
└── supabase/         # Client helpers (browser, server, service-role)
```

### `apps/ios/`

```
app/
└── index.tsx         # Root screen — placeholder for Phase A build
app.json              # Expo config (slug, bundle ID, splash, icons)
tsconfig.json         # Extends expo/tsconfig.base
package.json          # Expo + react-native-skia + @baseballczar/sim-engine
```

## Root Scripts

```bash
npm run dev          # Start web dev server (kills port 3000 first)
npm run build        # Production build (web)
npm run test         # Vitest unit tests (apps/web)
npm run test:e2e     # Playwright E2E tests (apps/web)
npm run sim          # Sim-engine CLI — 162-game season
npm run skill-test   # Skill sensitivity harness
npm run typecheck    # TypeScript check (packages/sim-engine)
```

## Key Concepts

- **Provisioning:** Signup creates a team, fills 5 AI managers, generates a 150-game schedule (50 rounds × 3 games).
- **Simulation:** Pure TypeScript engine — no DB calls during sim. Results persisted via batch RPC upserts.
- **Sim Engine (package):** Physics-based, seedable, zero external runtime deps. Shared by web and iOS via npm workspaces.
- **Event Log:** `buildEvents(gameResult)` derives a timestamped `SimEvent[]` timeline (13 event types) ready for 2D rendering.
- **Lineup Backfill:** Releasing/trading a starter auto-promotes bench players.
- **Training:** Skills improve between sim days, bounded by player potential.
- **Finance:** Budget enforcement via PostgreSQL CHECK constraints + safe debit/credit RPC.

## Sim Engine CLI

```bash
# From repo root (delegates to packages/sim-engine):
npm run sim
npm run sim -- --games 50 --seed 1
npm run sim -- --verbose
npm run sim -- --pbp
npm run sim -- --events out.json

# Or directly from packages/sim-engine:
npx tsx scripts/sim-lab.ts --games 10 --seed 42
npx tsx scripts/skill-test.ts --games 30
```

## Database Migrations

Seven migrations applied in order:

1. **001** — Initial schema (20 tables, RLS policies, indexes)
2. **002** — Seed 100 first/last names for player generation
3. **003** — Add ERA tracking columns to standings
4. **004** — Safe debit constraints, batch upsert RPC functions
5. **005** — Expand name pool + UNIQUE constraint on row_num
6. **006** — Expand name pool to 200+ entries
7. **007** — Add `country_id` column to players (default 1 = USA)

Apply all: `npx supabase db push`

## Testing

```bash
# Unit tests — 7 files, 60 assertions
npm run test

# E2E
npm run test:e2e

# Sim smoke tests (from apps/web/)
cd apps/web && npx tsx tests/seed-smoke-test.ts
cd apps/web && npx tsx tests/smoke-test.ts
```

## Deployment

- **Web:** Vercel. Set `Root Directory: apps/web` in the Vercel project dashboard.
- **iOS:** Expo EAS Build. Run `eas build --platform ios` from `apps/ios/`. Add your EAS project ID to `apps/ios/app.json`.

## UI Highlights

- **Roster page** — All 10 player skills, TOT column, Ht/Wt/Ctr demographics, country flag SVG
- **Lineup page** — Position dropdown per slot (C/1B/2B/3B/SS/LF/CF/RF/DH); bench labeled B1/B2/B3; drag-to-reorder; bench↔starter swap
- **Rotation page** — Three skill tables (SP1–5, RP1–4, Available); drag-to-reorder; assign buttons
- **Stats page** — Hitting (r/h/b2/b3) and pitching (ip/h/r/er/bb/so) columns fixed

## Improvement Plan Status

All 18 items from the original P0–P3 improvement plan have been implemented:

- **P0 (Critical):** Auth on all sim routes, budget transaction safety, rate limiting ✅
- **P1 (High):** Batch SQL upserts, DB constraints, standings fix ✅
- **P2 (Medium):** Vitest suite (60 tests), structured logging (Pino), cron sim, security headers, named constants ✅
- **P3 (Backlog):** Playwright E2E, CI/CD, Sentry monitoring, response caching, 200+ name pool, persist-game split ✅

## Code Review

- [BBZAR_MASTER_REVIEW.md](BBZAR_MASTER_REVIEW.md) — Master hub with severity matrix
- [review/01-correctness-logic.md](review/01-correctness-logic.md)
- [review/02-security.md](review/02-security.md)
- [review/03-architecture-design.md](review/03-architecture-design.md)
- [review/04-data-integrity.md](review/04-data-integrity.md)
- [review/05-error-handling.md](review/05-error-handling.md)
- [review/06-performance.md](review/06-performance.md)
- [review/07-readability-maintainability.md](review/07-readability-maintainability.md)
- [review/08-testing.md](review/08-testing.md)
- [review/09-improvement-plan.md](review/09-improvement-plan.md)
- [IOS_STRATEGY.md](IOS_STRATEGY.md) — iOS product strategy and 5-phase build plan
