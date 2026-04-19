# Baseball Czar v2

A baseball management simulation game where you draft players, set lineups, manage finances, and compete against AI-managed teams across a full season. Originally built as a Java desktop app with a separate simulation daemon — now rebuilt as a modern web application.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Server Components, Turbopack)
- **Language:** TypeScript (strict mode)
- **Database:** Supabase (PostgreSQL + Auth + Row Level Security)
- **Styling:** Tailwind CSS
- **Validation:** Zod v4
- **Monitoring:** Sentry (error tracking + tracing)
- **Rate Limiting:** Upstash Redis + Ratelimit
- **Testing:** Vitest (unit) + Playwright (E2E)
- **Queue (installed):** BullMQ + ioredis

## Prerequisites

- Node.js 20+
- npm
- A [Supabase](https://supabase.com) project (free tier works)
- Supabase CLI (`npx supabase`) for local development

## Getting Started

1. **Clone and install:**

   ```bash
   git clone https://github.com/rgriola/baseballczar.git
   cd baseballczar-v2
   npm install
   ```

2. **Configure environment:**
   Create `.env.local` with your Supabase credentials:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SENTRY_DSN=your-sentry-dsn          # optional
   UPSTASH_REDIS_REST_URL=...           # for rate limiting
   UPSTASH_REDIS_REST_TOKEN=...         # for rate limiting
   ```

3. **Apply database migrations:**

   ```bash
   npx supabase db push
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Login, signup, password reset
│   ├── api/              # 9 API route groups
│   │   ├── challenges/   # O2O challenge send/respond/sim
│   │   ├── cron/         # Automated sim scheduling
│   │   ├── games/        # Game detail lookup
│   │   ├── market/       # Free agent sign/release (with lineup backfill)
│   │   ├── payroll/      # Weekly salary deduction
│   │   ├── provision/    # Team creation + league fill
│   │   ├── sim/          # Game simulation (run, sim-all, status, reset)
│   │   ├── trades/       # List, offer, respond, withdraw
│   │   └── training/     # Assign slots, run daily training
│   ├── auth/callback/    # Supabase OAuth callback
│   └── dashboard/        # 14 feature pages
│   ├── roster/       # Team roster — all 10 skills, TOT, Ht/Wt/Ctr, country flag
│       ├── lineup/       # Batting order — roster-style table, position assignment (DH), B1/B2/B3 bench
│       ├── rotation/     # Pitching rotation — SP1-5 + RP1-4 with full skill table
│       ├── games/        # Game results and box scores
│       ├── schedule/     # Season schedule
│       ├── standings/    # League standings
│       ├── leaders/      # Statistical leaders (10 categories)
│       ├── stats/        # Detailed player statistics
│       ├── finance/      # Budget and transaction history
│       ├── market/       # Free agent signings
│       ├── trades/       # Player trading system
│       ├── training/     # Between-game skill development
│       ├── challenges/   # One-on-one exhibition games
│       └── notifications/# In-app notifications
├── lib/
│   ├── sim-engine/       # Pure TypeScript game simulation (~1,400 lines)
│   │   ├── GameEngine.ts # Main simulation loop
│   │   ├── AtBat.ts      # Plate appearance resolution
│   │   ├── Field.ts      # Baserunning state machine
│   │   ├── PlayerSkills.ts # Skill-to-probability conversion
│   │   ├── StatsAccumulator.ts # Per-PA stat crediting
│   │   ├── ScoreBoard.ts # Inning-by-inning score tracking
│   │   └── GateReceipts.ts # Revenue per game type
│   ├── sim/              # Database orchestration for game results
│   │   ├── simulate-scheduled-game.ts  # Load rosters → engine → persist
│   │   ├── persist-game.ts             # Multi-step DB write pipeline
│   │   └── persist-player-stats.ts     # Batch RPC upserts for season stats
│   ├── finance/          # Budget checks, safe debit/credit, transaction recording
│   ├── lineup/           # Lineup backfill utility (auto-fill 9 starters)
│   ├── trades/           # Trade proposal, execution, and player valuation
│   ├── training/         # Skill improvement system
│   ├── notifications/    # In-app notification dispatch
│   ├── provisioning/     # Team creation, AI fill, schedule generation
│   ├── queries/          # Shared DB queries (getMyTeam, requireMyTeam)
│   ├── seed/             # Player generation, schedule generation, 200+ names
│   └── supabase/         # Client helpers (browser, server, service-role)
├── middleware.ts          # Auth session refresh + route protection
supabase/
├── config.toml
└── migrations/            # 7 SQL migrations
│   ├── 001_initial_schema.sql
│   ├── 002_seed_names.sql
│   ├── 003_standings_era_columns.sql
│   ├── 004_safe_debit_constraints_batch_upsert.sql
│   ├── 005_expand_name_pool.sql
│   ├── 006_expand_name_pool_200.sql
│   └── 007_add_country_id.sql
tests/
├── unit/                  # 7 Vitest unit tests (60 assertions)
│   ├── at-bat.test.ts
│   ├── budget.test.ts
│   ├── constants.test.ts
│   ├── field.test.ts
│   ├── game-engine.test.ts
│   ├── gate-receipts.test.ts
│   └── player-skills.test.ts
├── e2e/
│   └── critical-paths.spec.ts  # Playwright E2E
├── seed-smoke-test.ts     # Player/schedule generation validation
└── smoke-test.ts          # Game simulation output analysis
```

## Key Concepts

- **Provisioning:** When a user signs up and creates a team, the system fills the remaining 5 teams with AI managers and generates a full 150-game season schedule (50 rounds × 3 games for 6 teams).
- **Simulation:** Games use a pure TypeScript engine — no database calls during simulation. Results are persisted via batch RPC upserts after each game. Full-season sim delegates to a dedicated API route with extended timeout.
- **Lineup Backfill:** When a starter is released or traded, the system auto-promotes bench players to maintain a 9-player lineup. The lineup editor also fills gaps on load. Bench players receive numbered slots (B1, B2, B3…) as their position.
- **Training:** Between sim days, players can train to improve skills (bounded by max potential).
- **Market:** Free agents can be signed if your budget allows. Players can also be listed for trade.
- **Finance:** Budget enforcement via safe debit/credit with CHECK constraints. Weekly payroll and game-day revenue.

## Development Scripts

```bash
npm run dev        # Start dev server (auto-kills port 3000 first)
npm run build      # Production build
npm run lint       # ESLint
npm run start      # Start production server
npm run test       # Run Vitest unit tests
npm run test:watch # Run Vitest in watch mode
npm run test:e2e   # Run Playwright E2E tests
```

## Testing

```bash
# Unit tests (7 files, 60 tests)
npm test

# Smoke tests
npx tsx tests/seed-smoke-test.ts   # Validate player/schedule generation
npx tsx tests/smoke-test.ts        # Validate game simulation output

# E2E
npm run test:e2e
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

## Code Review

A comprehensive code review is available in the `review/` directory:

- [BBZAR_MASTER_REVIEW.md](BBZAR_MASTER_REVIEW.md) — Master hub with project overview and severity matrix
- [review/01-correctness-logic.md](review/01-correctness-logic.md) — Game engine and business logic correctness
- [review/02-security.md](review/02-security.md) — Authentication, authorization, and input validation
- [review/03-architecture-design.md](review/03-architecture-design.md) — System architecture and design patterns
- [review/04-data-integrity.md](review/04-data-integrity.md) — Database constraints and data consistency
- [review/05-error-handling.md](review/05-error-handling.md) — Error handling and resilience
- [review/06-performance.md](review/06-performance.md) — Query optimization and scalability
- [review/07-readability-maintainability.md](review/07-readability-maintainability.md) — Code quality and conventions
- [review/08-testing.md](review/08-testing.md) — Test coverage and strategy
- [review/09-improvement-plan.md](review/09-improvement-plan.md) — Prioritized roadmap (P0–P3)

## Improvement Plan Status

All 18 items from the original P0–P3 improvement plan have been implemented:

- **P0 (Critical):** Auth on all sim routes, budget transaction safety, rate limiting ✅
- **P1 (High):** Batch SQL upserts, DB constraints, standings fix ✅
- **P2 (Medium):** Vitest suite (60 tests), structured logging (Pino), cron sim, security headers, named constants ✅
- **P3 (Backlog):** Playwright E2E, CI/CD, Sentry monitoring, response caching, 200+ name pool, persist-game split ✅

## UI Enhancements (Post-Review)

- **Roster page** — Displays all 10 player skills (SPD·STA·AG·EYE·AVG·STR·PI·BNT·FLD·THR), TOT column, Ht/Wt/Ctr demographics, country flag SVG
- **Lineup page** — Roster-style skill table; position dropdown per slot (C/1B/2B/3B/SS/LF/CF/RF/DH); bench players labeled B1/B2/B3…; drag-to-reorder; swap bench↔starter
- **Rotation page** — Three roster-style tables (SP1–5, RP1–4, Available); drag-to-reorder within groups; → SP / → RP assign buttons; full 10-skill display
- **Stats page** — Fixed column name mismatches for hitting (r/h/b2/b3) and pitching (ip/h/r/er/bb/so)
- **Migration 007** — Added `country_id int not null default 1` to players table; `CountryFlag` SVG component (US flag, extensible)
