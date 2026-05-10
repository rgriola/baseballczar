> Last touched by agent: 2026-05-10T20:34:00Z

# DO NOT BREAK — Verified Working Behaviors

> **Rule:** If any change causes these to regress, REVERT before continuing.
> Read this file at the START of every coding session.

---

## Sim Engine (`packages/sim-engine`)

- All randomness flows through `createRng(seed)` — **never** call `Math.random()`
- Skill values are 1–10 integers. Clamp to `Math.max(1, rawSkill)` — zero produces NaN/Infinity
- `CONFIG_V1` in `config.ts` is the single source of truth for all tunable parameters
- Engine is pure TypeScript — zero DB calls, zero DOM deps, zero Node-only imports
- Must run in React Native / JavaScriptCore environments

### Stat Baselines (CONFIG_V1, seed 1, 162 games)

| Stat | Target | Tolerance |
|------|--------|-----------|
| BB% | .085 | ±5% |
| K% | .251 | ±5% |
| BABIP | .322 | ±5% |
| HR/FB | .148 | ±5% |
| R/G | 4.08 | ±5% |

> If a sim-engine change moves these numbers beyond tolerance, document the reason in the commit message.

---

## Game Orchestrator & Tick Engine

- All 9 fielders render in **every** snapshot — `buildRestingFielders()` populates fielder arrays on all snapshot types (walks, Ks, mound breathers, inning changes)
- Fielder arrays swap when defense changes sides at half-inning transitions
- Inning-change snapshots fire on ALL transitions (not just pitching changes)
- Self-healing fielder sprites: `updateFielders()` auto-creates sprites on demand if missing
- Team color tint updates each frame — inning swaps show correct team colors immediately
- `speed` and `onEvent` are NOT in `loadSnapshots` effect dependencies — prevents spurious sprite destruction

### Pitch-by-Pitch Animation

- 3 snapshots per pitch: (1) ball at mound → (2) ball at plate → (3) ball idle
- Applies to both non-batted-ball ABs AND pre-contact pitches on batted-ball ABs
- Every pitch in an at-bat appears in PBP (289/289 verified at seed 1)
- Contact pitch injected into tick engine's first snapshot

### PBP Events

- Pitch MPH from `throwVelocityMph()` using pitcher `throwing` skill
- Pitch types: Four-seam (in zone), Slider (edge), Changeup (off)
- Zone narrative, swing/take labels, foul ball physics, contact descriptors all present
- Color-coded outcomes: balls sky-blue, strikes red, fouls amber, contact amber, HRs yellow

---

## Persistence (`persist-game.ts`)

Step order is sacred — **do not reorder**:

```
1. Game row + events
2. Game-level hitting/pitching stats
3. Season aggregate upserts
4. Standings update + schedule mark-played
5. Financial transactions (revenue)
```

- Replay sources outcomes from persisted events only (no hidden randomness)
- Linescore only persists played innings (no trailing 34-inning arrays)
- Schedule finalization guards with `played = false`
- Retry behavior is idempotent (no duplicate finalized game writes)
- **Roster snapshots** (`home_roster_snapshot`, `visitor_roster_snapshot`) are JSONB on the `games` row — captured at simulation time from `v2Team` objects
- The `persist_sim_game_transaction` RPC must include roster snapshot columns in its INSERT — if you add a column to the `games` table, you MUST also update the RPC function

---

## Client-Side Replay Re-Simulation

- Dashboard replays use the **tick engine** client-side when roster snapshots exist
- Pipeline: `createRng(sim_seed)` → `simulateGame()` → `simulateFullGame()` → 30fps `WorldSnapshot[]`
- Fallback: games without snapshots use legacy `buildPersistedSnapshots()` reconstruction
- `canResimulate()` guards: requires `sim_seed > 0` AND both roster snapshots with `lineup.length >= 9`
- Roster snapshots are **frozen at game time** — replays are immune to player trades/training/retirement
- Re-simulation is deterministic: same seed + same rosters = same game, always

---

## Ball Physics

### Sim Engine (`ballFlight.ts`)
- Grounder distance formula: `evNorm` MUST be clamped to [0, 1] — unclamped values produce impossible distances
- Max grounder distance: 150 ft (`20 + evNorm × 130`)
- Negative launch angles produce grounders, not fly balls with negative distances

### Tick Engine (`ballPhysics.ts`)
- Grounders (negative `baseVert`) bypass vertical calibration in `calibrateLaunch()` — **never** scale negative vVert by hang time
- Ground absorption is impact-velocity-dependent: harder impacts lose more energy
- Dirt surface absorbs 15% more than grass (`surfacePenalty = 0.85`)
- `BOUNCE_RESTITUTION` and `HORIZ_BOUNCE` constants are only for fly ball landings — grounders use the impact-scaled model

---

## Web App / UI

- Sim does NOT auto-run on page load — user must click Run or Random
- `pinned` starts at `0`, effect skips until user triggers
- Font families: Geist Sans + Geist Mono **only** — no third font
- Colors as 6-digit hex **only** — never `rgb()`, `hsl()`, or named colors
- Font sizes: only `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`

---

## Auth & API

- Every authenticated API route follows: `Zod validation → Auth check → Ownership verification → Business logic → DB mutation`
- Sim routes (`/api/sim/*`) are protected — never skip auth
- DB error messages are never exposed to clients — log server-side, return generic message
- Service-role client never used in user-facing routes unless protected by Bearer token check

---

## Queue / BullMQ

- Custom job IDs use hyphens, **never** colons (e.g., `schedule-${id}`, not `schedule:${id}`)
- Worker bootstrap hydrates env from `.env.local` and pings Redis before listening
- BullMQ requires TCP Redis (`REDIS_URL`), not REST-only Upstash vars

---

## Verification Commands

```bash
npm run test              # Vitest — all 16 test files must pass
npm run typecheck         # TypeScript check (packages/sim-engine)
npm run sim               # 162-game season — check baselines
npm run skill-test        # Skill sensitivity harness
```

### Critical Test Files (must pass)

| Test | What it guards |
|------|---------------|
| `persisted-replay-regression.test.ts` | DB skill mapping, runner profiles, chopped-ball apex, fielder movement caps, throw timing |
| `persisted-replay-golden.test.ts` | Snapshot/event ordering and timing for persisted ground-out |
| `game-result-contract.test.ts` | Sim contract metadata integrity |
| `game-engine.test.ts` | Core engine behavior |
| `at-bat.test.ts` | At-bat resolution logic |
| `field.test.ts` | Field mechanics |
| `responsibilities.test.ts` | Fielder responsibility assignments |
| `play-intelligence.test.ts` | PI-driven decisions |
| `advance-resolver.test.ts` | Runner advancement logic |
| `infield-fly.test.ts` | Infield fly rule |

---

## Dual-Source Warning

`packages/tick-engine/src/` and `apps/web/src/components/sim-v2-tick/` must be kept in sync manually. If you change one, change the other. This is a known issue (SIM_STATUS.md #5).
