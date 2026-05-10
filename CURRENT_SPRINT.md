> Last touched by agent: 2026-05-10T14:31:00Z

# Current Sprint

> **Rule:** AI agents must read this file before starting any work.
> Only work within the stated scope. If you think something outside scope needs changing, ASK FIRST.

---

## Active Goal

<!-- Replace this with your current objective -->
_No active sprint defined — update this section before starting work._

---

## Scope

### Files ALLOWED to change
<!-- List specific files or directories the AI may modify -->
```
(define before each session)
```

### Files OFF LIMITS
<!-- These files must not be modified without explicit approval -->
```
packages/sim-engine/src/config.ts          # Game balance — never touch without baseline re-check
apps/web/src/lib/sim/persist-game.ts       # Persistence step order is sacred
apps/web/tests/fixtures/                   # Golden fixtures — never modify to make tests pass
.github/workflows/replay-lock-in.yml       # CI guardrail — do not weaken
DO_NOT_BREAK.md                            # Guardrail doc — do not remove items
```

---

## Acceptance Criteria

<!-- Define specific, testable outcomes before starting -->
- [ ] _Criterion 1_
- [ ] _Criterion 2_
- [ ] _Criterion 3_

---

## Do NOT

<!-- Explicit prohibitions for this sprint -->
- Do not refactor files outside the stated scope
- Do not change snapshot/entity type definitions in `entities.ts` unless the goal requires it
- Do not modify `CONFIG_V1` tunable parameters without re-running baselines
- Do not skip running `npm run test` before and after changes
- Do not add new font families, color formats, or font sizes

---

## Session Log

<!-- AI agents: append a brief entry after each session -->

| Date | Agent | Summary | Tests |
|------|-------|---------|-------|
| 2026-05-10 | Antigravity | Deep audit of sim-lab-2: skill wiring review (12 skills), dual-source drift analysis, Statcast collision model research, created 26-test baseline suite for tick-engine package, locked decisions (Phase 4 after merge, package wins, Option A for Statcast EV formula) | tick-engine: 26/26 ✅ |
| 2026-05-10 | Antigravity | **Phase 1 complete**: (1) unified speed/throw formulas → sim-engine imports, (2) fixed resting fielder speed from 0 to real skills, (3) runners now visible during pitch sequences, (4) pitch velocity derived from pitcher TH skill, (5) fixed AG misuse as "disciplined" → uses eye, (6) added catcher throw-back at 70% | web: 145/146 ✅ (1 pre-existing), tick: 26/26 ✅, tsc: 0 errors |
| 2026-05-10 | Antigravity | **Phase 2 complete**: (7) PI → fielder route efficiency/decision speed/catch radius, (8) AG → runner acceleration ramp (0.5-1.4s), (9) ST → pitch velocity fatigue (starts at 70 pitches, ST dampens loss), (10) entity types updated with playIntelligence + agility fields | web: 145/146 ✅ (1 pre-existing), tick: 26/26 ✅, tsc: 0 errors |
| 2026-05-10 | Antigravity | **Phase 3 complete**: Ported all Phase 1+2 improvements to `packages/tick-engine/` (unified formulas, PI wiring, AG ramp, stamina fatigue). Deleted 12 dead sim files from `apps/web/sim-v2-tick/` (only renderer files remain). Added play-complete safety fallback on timeout. Web already imports from package. | web: 145/146 ✅ (1 pre-existing), tick: 26/26 ✅, tsc: 0 errors |
| 2026-05-10 | Antigravity | **Phase 4 complete**: Replaced linear EV formula with Statcast collision model (`V_exit = q×V_pitch + (1+q)×V_bat`). Pitcher TH now directly affects exit velocity. Added squared-up multiplier (AVG vs AVG), pitcher control disruption (EYE), VAA bias on launch angle (TH), timing noise (EYE). Config-driven with tunable params. Added 6 Statcast-specific tests. Rebuilt sim-engine dist. | web: 145/146 ✅ (1 pre-existing), tick: 32/32 ✅, tsc: 0 errors |

---

## Backlog (Out of Scope — Do Later)

<!-- Items noticed during work that should NOT be done now -->
- 
- 
- 

---

## How to Use This File

1. **Before each session:** Fill in "Active Goal", "Scope", and "Acceptance Criteria"
2. **During work:** AI stays within scope; logs items to "Backlog" if it finds something outside scope that needs fixing
3. **After each session:** AI adds a row to "Session Log" with date, summary, and test results
4. **Between sprints:** Move completed criteria, clear the goal, and define the next one
