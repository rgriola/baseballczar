# Sim Lab 2 — Status & TODO

> Last updated: 2026-05-04 (evening)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  sim-engine (packages/sim-engine)                       │
│  Pure dice-rolling: pitches, outcomes, stats             │
│  Output: AtBatRecord[] with PitchEvent[] per AB          │
└─────────────────┬───────────────────────────────────────┘
                  │ GameResult
                  ▼
┌─────────────────────────────────────────────────────────┐
│  gameOrchestrator.ts (Hybrid Bridge)                    │
│  Chains at-bats into continuous timeline:                │
│  • Pitch-by-pitch animation (ball mound → plate)        │
│  • Tick physics for batted balls                         │
│  • Resting fielders in every snapshot                    │
│  • Manager decisions (shifts, pitching changes)          │
│  Output: WorldSnapshot[] + StrategicLog                  │
└─────────────────┬───────────────────────────────────────┘
                  │ WorldSnapshot[]
                  ▼
┌─────────────────────────────────────────────────────────┐
│  tickScene.ts (Pixi.js Renderer)                        │
│  Interpolates between snapshots at playback speed        │
│  Emits TickEvents → formatPbp.ts → PBP panel            │
└─────────────────────────────────────────────────────────┘
```

---

## ✅ Completed Work (May 4, 2026)

### 12-Skill Refactor
- Split legacy `defense` → `fielding` (glove) + `throwing` (arm strength)
- Removed `pitchIntel` → absorbed into `eye` (control) + `playIntelligence` (decisions)
- Fixed `AG` — now means agility/reaction, not plate discipline
- `playIntelligence` (PI) now required (no more `?? 5` defaults)
- Hidden skills: `DHR`, `BNT`, `karma` in data but hidden from manager UI
- All physics layers updated: `battedBall.ts`, `physics/throw.ts`, `physics/speed.ts`
- Roster UI shows 9 visible skills per player (Physical → Hitting → Fielding → Mental)
- Bullpen UI includes EYE + PI for manager decisions
- Zero TS errors across all packages

### Fielder Rendering Fix
- **Root cause:** Non-batted-ball snapshots (walks, Ks, mound breathers, inning changes) had `fielders: []`, so no sprites were ever created if the game started with a strikeout/walk
- **Fix:** Added `buildRestingFielders()` helper — builds 9-player fielder array at home positions from defense map. Every snapshot now carries fielders (10,500+ snapshots, zero empty)
- Fielder arrays swap when defense changes sides at half-inning transitions
- Inning-change snapshots now fire on ALL transitions (not just pitching changes)

### Pitch-by-Pitch Animation
- **Before:** Walks/Ks were a single invisible snapshot. Ball state was `'idle'` (hidden). Field looked frozen.
- **After:** `emitPitchSnapshots()` creates 3 snapshots per pitch:
  1. Ball at mound (`in-flight`, visible) — PBP events fire
  2. Ball at plate (`in-flight`, visible) — arrives at catcher
  3. Ball back idle (hidden) — pause before next pitch
- Applies to both non-batted-ball ABs AND pre-contact pitches on batted-ball ABs
- Full count builds up in PBP synced to visual ball travel

### Visual Polish
- Removed static position labels (CF, LF, etc.) from field background — player sprites carry their own label
- Fielder sprite radius: reduced from `scale × 3.5` to `scale × 3` to match runner size
- Ball shadow: flipped behavior — small/faint on ground, grows large when airborne (landing zone indicator)

### Rich Play-by-Play
- **Every pitch accounted for**: 289/289 pitches verified in PBP — including contact pitches (previously skipped)
- **Pitch MPH**: Real velocity computed from pitcher `throwing` skill via `throwVelocityMph()` (e.g. 91 mph Four-seam, 78 mph Changeup)
- **Pitch type labels**: Four-seam (in zone), Slider (edge), Changeup (off)
- **Zone narrative**: "right down the middle", "paints the corner", "just misses", "well outside"
- **Swing/take**: "Takes for a ball", "Chases — swinging strike", "Called strike"
- **Foul ball physics**: Exit velo, launch angle, distance, spray direction shown on fouls
- **Contact descriptors**: "Lines it hard", "Drives it deep", "Pops one up", "Rifles a line drive" — based on LA + exit velo
- **Batted ball stats**: EV mph | LA° | Spray° | distance ft | apex height | hang time
- **Fielding narrative**: Position-specific verbs ("tracks it down", "charges in and scoops it", "snags it off the mound")
- **Pitcher skills in header**: Now shows CTRL, ARM (throwing), STM
- **Color-coded outcomes**: Balls sky-blue, strikes red, fouls amber, contact amber, HRs yellow

### Renderer Stability
- **Self-healing fielder sprites**: `updateFielders()` auto-creates sprites on demand if missing — fielders can never be invisible regardless of initialization order
- **Team color live update**: Fielder body tint updates each frame, so inning swaps show correct team colors immediately
- **Effect dependency fix**: Removed `speed` and `onEvent` from `loadSnapshots` effect deps — prevents spurious sprite destruction on speed change or re-render
- **Contact pitch injection**: `buildPitchTickEvents()` for the contact pitch is injected into the tick engine's first snapshot, so "Pitch 3: Four-seam 91 mph" appears before the "Contact:" line

### Package Sync
- **Root cause of stale PBP**: Page imports from `@baseballczar/tick-engine` package, not `apps/web/src/components/`. All updates to `formatPbp.ts`, `entities.ts`, `gameOrchestrator.ts` now synced to both locations
- **GameSession.ts** updated with `throwing` field on pitcher at-bat-start event

### UX
- Sim no longer auto-runs on page load — user must click Run or Random
- `pinned` starts at `0`, effect skips until user triggers

---

## 📋 TODO — Prioritized

### 🔴 High Priority

- [ ] **Karma attribute** — Link `karma` into high-pressure decision branch of `aiManager`. Affects clutch at-bats (close games, late innings, runners in scoring position)
- [ ] **Pitching substitution logic** — Bullpen management: Starter → Reliever 1-5. Closer used with ≤3 innings remaining. Previous/next game starter excluded from bullpen
- [ ] **Rotation cycling** — Starter 1 gets game 1, Starter 2 gets game 2, etc. Currently broken — same starter every game, warping HR/K counts
- [ ] **Runners visible during pitch-by-pitch** — Runners on base should appear during walk/K at-bats (currently `runners: []` in pitch snapshots)

### 🟡 Medium Priority

- [ ] **Batter/Pitcher sprites** — Show batter in the box and pitcher on the mound during pitch animation (currently only ball moves)
- [x] **Pitch type variety** — ~~Currently only `fastball` vs `offspeed` label.~~ Now shows Four-seam/Slider/Changeup with real MPH from `throwVelocityMph()`
- [ ] **Foul ball animation** — PBP now shows foul ball exit velo/LA/distance/spray. Still needs visual ball launch animation on the field
- [ ] **Scrub/seek PBP fix** — `lastEventSnapIdx` resets on seek, re-firing all events when scrubbing backward
- [ ] **Team color persistence** — After inning change, resting fielders use correct team color but tick-engine subsequent snapshots use `teamColor: 0x0` (placeholder)
- [ ] **HUD out counter timing** — Outs in `gameState` reflect count at start of AB, not after the result. One-behind feel during playback

### 🟢 Nice to Have

- [ ] **Full pitch visualization** — Pitch trajectory with break/curve based on pitch type (fastball straight, curve drops, slider sweeps)
- [ ] **Catcher receive animation** — Catcher sprite at home plate receives the ball with a brief glove flash
- [ ] **Between-inning animation** — Teams visually swap: fielders jog to dugout, new team takes the field
- [ ] **Crowd/atmosphere** — Sound effects or ambient visuals that react to game state (cheers on HR, groans on K)
- [ ] **Speed control refinement** — Separate pitch speed from fielding speed (pitch-by-pitch can be fast while batted ball physics play at 1×)
- [ ] **Box score live update** — Box score panel updates in real-time during playback, not just at end
- [ ] **Highlight reel** — Auto-detect exciting plays (diving catch, close play at plate, HR) and allow replay

---

## Key Files

| File | Purpose |
|------|---------|
| [gameOrchestrator.ts](apps/web/src/components/sim-v2-tick/gameOrchestrator.ts) | Chains at-bats, pitch animation, fielder persistence |
| [tickEngine.ts](apps/web/src/components/sim-v2-tick/tickEngine.ts) | Per-tick physics for batted balls |
| [tickScene.ts](apps/web/src/components/sim-v2-tick/tickScene.ts) | Pixi.js renderer, interpolation, event dispatch |
| [entities.ts](apps/web/src/components/sim-v2-tick/entities.ts) | All entity/snapshot/event type definitions |
| [formatPbp.ts](apps/web/src/components/sim-v2-tick/formatPbp.ts) | TickEvent → rich narrative PBP entries |
| [aiManager.ts](apps/web/src/components/sim-v2-tick/aiManager.ts) | Defensive alignment, pitch selection, signals |
| [strategicManager.ts](apps/web/src/components/sim-v2-tick/strategicManager.ts) | Pitching changes, pinch decisions, inning transitions |
| [drawField.ts](apps/web/src/components/sim-v2/field/drawField.ts) | Static field rendering (grass, dirt, bases, dugouts) |
| [page.tsx](apps/web/src/app/sim-lab-2/page.tsx) | Sim Lab 2 UI — controls, PBP panel, roster, box score |
| [types.ts](packages/sim-engine/src/types.ts) | 12-skill PlayerSkills interface |
| [meaning-of-skills.md](meaning-of-skills.md) | Definitive guide to all skill definitions |

---

## Known Issues

1. ~~**Pitch speed display** — All pitches show as "fastball" or "offspeed"~~ ✅ Fixed — now shows Four-seam/Slider/Changeup + real MPH
2. **Team color on tick snapshots** — Subsequent tick-engine snapshots may use `teamColor: 0` (partially mitigated by live tint update)
3. **Seek re-fires events** — Scrubbing backward replays all PBP events from the beginning
4. **Single pitcher per game** — `awayTeam.rotation[0]` is always used for pitcher name, even after pitching changes
5. **Dual-source code** — `packages/tick-engine/src/` and `apps/web/src/components/sim-v2-tick/` must be kept in sync manually until a proper barrel export is set up
