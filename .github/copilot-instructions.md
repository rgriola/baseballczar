# Baseball Czar — Copilot Instructions

> Last touched by agent: 2026-04-30T13:46:48Z

---

## App Goals

Baseball Czar is a **browser-based baseball general-manager simulator**.
Players draft a team, set lineups, manage finances, trade players, and compete across a full 150-game season. A pure-TypeScript simulation engine resolves games using physics-based models and a seedable RNG — no randomness is hidden from replay.

The primary delivery target is **iOS** (React Native + Expo);
the **Next.js web app** is the secondary surface (dashboard, admin, spectator). Both share `packages/sim-engine` — a zero-dependency TypeScript package.

---

## Tech Stack

| Layer         | Technology                                        |
| ------------- | ------------------------------------------------- |
| Monorepo      | npm workspaces (`apps/*`, `packages/*`)           |
| Web framework | Next.js 16 — App Router, Server Components        |
| iOS framework | Expo + React Native + react-native-skia           |
| Language      | TypeScript (strict mode everywhere)               |
| Database      | Supabase (PostgreSQL + Auth + Row Level Security) |
| Styling       | Tailwind CSS                                      |
| Validation    | Zod v4                                            |
| Logging       | Pino (structured JSON)                            |
| Monitoring    | Sentry                                            |
| Rate limiting | Upstash Redis + Ratelimit                         |
| Testing       | Vitest (unit) + Playwright (E2E)                  |
| Job queue     | BullMQ + ioredis (installed; not yet fully wired) |
| Deployment    | Vercel (web) · Expo EAS (iOS)                     |

---

## Repository Layout

```
baseballczar-v2/
├── apps/
│   ├── web/              # Next.js web app (@baseballczar/web)
│   └── ios/              # Expo React Native app (@baseballczar/ios)
├── packages/
│   └── sim-engine/       # Shared physics sim engine (@baseballczar/sim-engine)
├── .github/
│   └── copilot-instructions.md   ← you are here
├── review/               # Nine detailed code-review documents
├── STYLING.md            # Font, size, and color conventions
└── README.md             # Full project overview and dev setup
```

---

## Development-Mode Rules (Active Until Production Hardening)

These rules apply to every file an agent touches:

1. **Date/time stamp** — Add or update a comment at the very top of every file you modify:

   ```
   // Last touched by agent: YYYY-MM-DDTHH:MM:SSZ
   ```

   For markdown files use:

   ```
   > Last touched by agent: YYYY-MM-DDTHH:MM:SSZ
   ```

2. **File purpose** — New files must include a one-line description (≤ 100 characters) immediately after the timestamp comment. Example:

   ```ts
   // Purpose: Converts raw Supabase row types to domain Player objects (≤100 chars)
   ```

   We do **not** need to retroactively add purpose comments to existing files.

3. **Line-count limit** — No file should exceed **800 lines**. When a file approaches this limit, refactor it by extracting cohesive concerns into sibling files. See the refactor guidance below.

---

## Styling Conventions

Full details live in [`STYLING.md`](../STYLING.md) at the repo root.

**Quick reference:**

- **Font families:** Maximum 2 — `Geist Sans` (body/UI) and `Geist Mono` (code/stats).
- **Font sizes:** Maximum 5 distinct sizes — use Tailwind's `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`.
- **Colors:** Always written as hex `#XXXXXX`. Never named colors, never `rgb()`, never `hsl()`. Define new colors in `tailwind.config.ts` or as CSS custom properties in `globals.css`.

---

## Code Conventions

### TypeScript

- Strict mode is on — no `any`, no non-null assertions without a comment explaining why.
- Use Zod v4 to validate **all** API route inputs before touching the DB.
- `db-types.ts` is the single source of truth for Supabase row types.
- Prefer `type` over `interface` for plain data shapes; use `interface` for extendable contracts.

### Next.js App Router

- **Server Components by default.** Only add `'use client'` when you need interactivity.
- Data fetching belongs at the page level (RSC), not inside client components.
- Use `useTransition` + `router.refresh()` for client-side mutations.
- API route response shape is always `{ error: string }` or `{ success: true, data?: ... }`.
- HTTP status codes must be used correctly (200/201/400/401/403/404/409/500).

### API Route Auth Pattern

Every authenticated API route must follow this order:

```
Zod validation → Auth check → Ownership verification → Business logic → DB mutation
```

There are two auth types:

- **User session** — call `createClient()` and verify `supabase.auth.getUser()`
- **Bearer token** — compare `Authorization` header against `SUPABASE_SERVICE_ROLE_KEY`

Do not skip auth. The four sim routes (`/api/sim/*`) were previously unprotected — that was the #1 critical security finding.

### Supabase Client Usage

| Client                  | Location                  | When to use                                  |
| ----------------------- | ------------------------- | -------------------------------------------- |
| `createClient()`        | `lib/supabase/server.ts`  | Server Components, API routes (user context) |
| `createBrowserClient()` | `lib/supabase/client.ts`  | Client Components only                       |
| `createServiceClient()` | `lib/supabase/service.ts` | Cron jobs, system ops that bypass RLS        |

Never use the service-role client in user-facing routes unless the route is protected by a Bearer token check.

### Sim Engine Rules

- The engine (`packages/sim-engine/`) is **pure TypeScript — zero DB calls, zero DOM deps**.
- Add no Node.js-only imports. It must run in React Native / JavaScriptCore.
- All randomness flows through `createRng(seed)` — never call `Math.random()` inside the engine.
- Skill values are 1–10 integers. Never allow 0 — clamp to 1 minimum before computing probabilities (0 produces degenerate thresholds).
- `CONFIG_V1` in `config.ts` is the single source of truth for all tunable parameters.

---

## Common Pitfalls to Avoid

### 1. Skill value of 0 causes NaN/Infinity

Player skills come from `Math.floor(Math.random() * 7)` which can produce 0.
A skill of 0 fed into the threshold formulas creates NaN or division-by-zero.
**Fix:** Clamp every skill to `Math.max(1, rawSkill)` at generation time.

### 2. Winner-take-all at-bat threshold

`AtBat.ts` currently uses only the dominant player's probability table.
A pitcher with TOT=30 vs a hitter at TOT=29 produces the same result as 30 vs 1.
**Fix:** Blend tables with a weighted average (`weight = ratio / (1 + ratio)`).

### 3. Reliever re-use bug

`GameEngine.ts` picks relievers randomly without tracking who has already pitched.
A reliever can be re-entered after being removed — illegal in baseball.
**Fix:** Maintain a `usedRelievers: Set<number>` per team per game.

### 4. Provisioning is a synchronous mega-operation

When the 6th team joins, `provision-team.ts` synchronously inserts 200+ rows.
If it fails mid-way the league is partially created with no rollback.
**Fix:** Wrap in a transaction or move to a BullMQ job returning immediately to the user.

### 5. Auth boilerplate copy-paste

14+ API routes each copy the same 10-line auth block.
Forgetting to paste it was the original cause of the unauthenticated sim routes.
**Fix:** Use the helpers in `lib/api/auth.ts` (`requireUser`, `requireTeamOwner`, `requireServiceKey`).

### 6. DB error messages exposed to clients

Never forward `error.message` from Supabase to the HTTP response — it can leak table names and schema details.
**Fix:** Log the real error server-side with Pino; return a generic `"An internal error occurred"` to the client.

### 7. Free-agent signing race condition

The sign flow queries player status then updates. Another team can sign between the two steps.
**Fix:** Use `.eq('roster_status', 'free_agent')` in the `UPDATE` clause and check the affected-row count.

### 8. Magic numbers in skill math

`PlayerSkills.ts` contains many unexplained numeric constants (e.g., `0.025`, `0.007`, `0.35`).
These directly control game balance and must be traceable.
**Fix:** Extract to named constants in `config.ts` or a `SKILL_COEFFICIENTS` object with comments.

### 9. Dual sources for seed names

Player names exist in both a SQL migration and `src/lib/seed/data.ts`. They can drift.
**Fix:** SQL migration is the DB source; TypeScript file is the runtime source. Keep them in sync or generate one from the other.

### 10. BullMQ is installed but not wired

`bullmq` and `ioredis` are in `package.json` but the worker process is not connected.
Do not add more BullMQ queue definitions without also wiring a consumer.

---

## Refactoring Guidance (800-line Rule)

When a file approaches 800 lines, extract cohesive concerns:

**`persist-game.ts` (~450 lines)** — split by step group:

- `persist-game-record.ts` — game row + events
- `persist-player-stats.ts` — game-level hitting/pitching stats
- `persist-season-stats.ts` — season aggregate upserts
- `persist-standings.ts` — standings update + schedule mark-played
- `persist-revenue.ts` — financial transactions

**`GameEngine.ts` (~360 lines)** — acceptable at current size; keep cohesive.

**`Field.ts` (~350 lines)** — acceptable; extract runner-advancement helpers if it grows.

---

## Testing

```bash
npm run test          # Vitest unit tests (apps/web) — 60 assertions across 7 files
npm run test:e2e      # Playwright E2E (apps/web)
npm run sim           # Sim-engine CLI — 162-game season, random seed
npm run skill-test    # Skill sensitivity harness
npm run typecheck     # TypeScript check (packages/sim-engine)
```

Baseline: `CONFIG_V1` at seed 1 over 162 games should produce:

- BB% ≈ .085 · K% ≈ .251 · BABIP ≈ .322 · HR/FB ≈ .148 · R/G ≈ 4.08

If a sim-engine change moves these numbers by more than ±5%, document the reason in the commit message.

---

## Environment Variables (web)

| Variable                        | Required | Notes                                          |
| ------------------------------- | -------- | ---------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | ✅       | Supabase project URL                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅       | Public anon key                                |
| `SUPABASE_SERVICE_ROLE_KEY`     | ✅       | Server-only admin key — never expose to client |
| `CRON_SECRET`                   | ✅       | Vercel sends this on cron requests             |
| `SENTRY_DSN`                    | optional | Error tracking                                 |
| `UPSTASH_REDIS_REST_URL`        | optional | Rate limiting                                  |
| `UPSTASH_REDIS_REST_TOKEN`      | optional | Rate limiting                                  |

---

## Deployment

- **Web:** Vercel. Set `Root Directory: apps/web`. Migrations: `npx supabase db push`.
- **iOS:** Expo EAS. Run `eas build --platform ios` from `apps/ios/`.
- **Crons:** Defined in `apps/web/vercel.json`. Daily 4 AM UTC (sim + training + expiry), Monday 5 AM UTC (payroll).
