# Baseball Czar v2

A baseball management simulation game where you draft players, set lineups, manage finances, and compete against AI-managed teams across a full season. Originally built as a Java desktop app with a separate simulation daemon — now rebuilt as a modern web application.

## Tech Stack

- **Framework:** Next.js 14 (App Router, Server Components)
- **Language:** TypeScript (strict mode)
- **Database:** Supabase (PostgreSQL + Auth + Row Level Security)
- **Styling:** Tailwind CSS
- **Validation:** Zod v4
- **Queue (planned):** BullMQ + ioredis

## Prerequisites

- Node.js 20+
- npm
- A [Supabase](https://supabase.com) project (free tier works)
- Supabase CLI (`npx supabase`) for local development

## Getting Started

1. **Clone and install:**

   ```bash
   git clone <repo-url>
   cd baseballczar-v2
   npm install
   ```

2. **Configure environment:**
   Create `.env.local` with your Supabase credentials:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
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
│   ├── api/              # 18 API routes (sim, market, trades, training, etc.)
│   ├── auth/callback/    # Supabase OAuth callback
│   └── dashboard/        # 13 feature pages
│       ├── roster/       # Team roster with active/reserve toggle
│       ├── lineup/       # Batting order management
│       ├── rotation/     # Pitching rotation
│       ├── games/        # Game results and box scores
│       ├── schedule/     # Season schedule
│       ├── standings/    # League standings
│       ├── leaders/      # Statistical leaders (10 categories)
│       ├── stats/        # Detailed player statistics
│       ├── finance/      # Budget and transaction history
│       ├── market/       # Free agent signings
│       ├── trades/       # Player trading system
│       ├── training/     # Between-game skill development
│       └── challenges/   # One-on-one exhibition games
├── lib/
│   ├── sim-engine/       # Pure TypeScript game simulation (~1,400 lines)
│   │   ├── GameEngine.ts # Main simulation loop
│   │   ├── AtBat.ts      # Plate appearance resolution
│   │   ├── Field.ts      # Baserunning state machine
│   │   └── PlayerSkills.ts # Skill-to-probability conversion
│   ├── sim/              # Database orchestration for game results
│   ├── finance/          # Budget and transaction logic
│   ├── trades/           # Trade proposal and execution
│   ├── training/         # Skill improvement system
│   ├── provisioning/     # Team creation and league setup
│   └── supabase/         # Supabase client helpers
├── middleware.ts          # Auth session refresh
supabase/
├── config.toml
└── migrations/            # 3 SQL migrations (schema, seed names, standings)
tests/
├── seed-smoke-test.ts     # Player/schedule generation validation
└── smoke-test.ts          # Game simulation output analysis
```

## Key Concepts

- **Provisioning:** When a user signs up and creates a team, the system fills the remaining 5 teams with AI managers and generates a full season schedule.
- **Simulation:** Games use a pure TypeScript engine — no database calls during simulation. Results are persisted after each game completes.
- **Training:** Between sim days, players can train to improve skills (bounded by max potential).
- **Market:** Free agents can be signed if your budget allows. Players can also be listed for trade.

## Development Scripts

```bash
npm run dev       # Start dev server (kills any existing process on :3000)
npm run build     # Production build
npm run lint      # ESLint
npm run start     # Start production server
```

## Smoke Tests

```bash
npx tsx tests/seed-smoke-test.ts   # Validate player/schedule generation
npx tsx tests/smoke-test.ts        # Validate game simulation output
```

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
