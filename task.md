> Last touched by agent: 2026-05-06T14:17:28Z

# Tasks

> Active task backlog. New work goes under the matching priority bucket.
> When a task starts, mark it `in-progress`; when done, move to **Done**
> with the commit SHA.

**Priorities:** `P0` ship-blocking · `P1` next sprint · `P2` polish ·
`P3` someday

---

## P0 — Calibration & correctness

- [x] **Recalibrate `expectedRanges`** to the post-foul-fix model. Run a 162-game @ seed 1 sim, capture rates, widen/tighten bands so a clean run is all-green. Keep the old bands as a comment for reference.
- [x] **Decide on HR/FB fix**: keep current `powerToExitVeloMph` + drag mapping; baseline `hrPerFb` is already in-band.
- [x] **Add `foulPerContact` guardrail** to `expectedRanges` + `report.ts` so a future spray tweak can't silently push the foul ratio out of MLB range.
- [x] **Commit current foul/triples work** as one atomic commit ("sim: speed-dominant range, corner caroms, foul rate 0.45, OF positions").

## P1 — Sim engine gameplay logic

## player logic moved to player_play_integlligence.md

- [x] **Fielder target-base decision tree** (issue S-10). Branch on `(outs, runners, hitLocation, hitType, scoreMargin)`. Start with the standard tree from `player_play_integlligence.md`:
  - 0 out, R1, grounder to MIF → DP attempt (2B → 1B)
  - 2 outs, any → easy out at 1B
  - R3 with < 2 outs → look runner back, throw 1B
  - Score-aware: lead ≥ 5 runs → throw to 2B not home
  - 0 out lead ≥ 5 runs, priority is getting outs.
- [x] **Spray-aware r1→3rd** (issy ue S-15). RF singles raise the advance probability; LF singles lower it. PI + speed gated.
- [x] **PI-gated tag-up** (issue S-14). Replace flat `sacFlyTagProb` with `f(PI, speed, depth, defense.arm)`.
- [x] **Pitcher / 1B backup logic** (issue S-12). 1B-man covers 1B on 4-6-3 (already done),5-4-3, 6-4-3 double play. 2B at 2B for SS field, etc. Pitcher backs up home/3B on extra-base hits; long fly ball sac fly (runner on 3B) Pitcher would back up home immediately.
- [x] **Doubles distribution work** (issue S-01). Decision for current baseline: accept ~0.5 2B per team-game for now to avoid foul/HR side effects from widening spray spread.
  - widen `sprayStdDevDeg` 18 → 22 (more line traffic, side effect: more fouls/HRs)
  - keep normal OF speed and agility, only penalty for running backwards.
  - or stop chasing the 1.5/g number and accept ~0.5/g for now. << what does this mean? >>

## P1 — Renderer / sim-v2

- [x] **Wall ricochet visualization** (issue R-04). Renderer must consume `wallHitPoint` + `wallBounceSpeedFps` and play the ricochet segment. << The Ricohet has an issue >>
- [x] **Ball roll-to-stop** (issue R-03). Tween must complete the full `restPoint` segment, not cut off at landing.
- [x] **HR clearance pixel rounding** (issue R-01). Wall sprite vs. ball-z math; verify ball is drawn above wall when `apex > wallHeightFt`.
- [x] **HR trot path regression** (issue R-02). Make sure the HR trot waypoint list is `home → 1B → 2B → 3B → home`, not collapsed to mound. << can we add rounding base paths to runners removing 90º turns. >>
- [x] **Persist team errors for replay R/H/E.** Add `home_errors` + `visitor_errors` to game persistence and feed replay E column from DB values.

## P1 — Web Dev Compile Performance

- [x] **Profile webpack cold compile for `/sim-lab-2`.** Captured stats in webpack profile mode and documented top compile-time + fan-out modules.
- [x] **Evaluate worker graph externalization.** Prototyped lazy worker/dynamic fallback sim import in Sim Lab 2 and measured before/after cold+warmed behavior.
- [x] **Create repeatable benchmark workflow.** Standardized one cold + two warm passes and logged workflow/results in `apps/web/perf/dev-compile-sim-lab-2.md`.
- [x] **Define pass acceptance criteria.** Added explicit median cold / warm pass thresholds in the perf tracking doc.

## P2 — Roster / lineup

- [x] **Starter rotation** (issue L-01). Track `team.nextStarterIdx`; cycle SP1→SP5 across schedule;
- [x] **Closer (`CL`) position** (issue L-02). Add `CL` to the position enum, surface on rotation page, route late-inning + close-game appearances to CL.
- [x] **12 - pitcher roster enforcement** (issue L-03). 5 SP + 5 RP; rotation page shows all 10. Make this Dynamic, Minimum of 10, Max of 12 but this subtracts from Max 25 player roster. Lineup - always 9 batters - substitutes go in place of the player they replaced (defensive or hitting). We need error checking should a team fall below these margins the Sim auto signs players or adjusts the lineup, but first line of error check is User Web UI.

## P2 — Renderer polish

- [x] **Fielder pursuit easing** (issue R-06). Confirm sprite tween uses linear ft/sec from converge event; remove any easing curve.
- [x] **Batter sprite z-order** (issue R-05). Sprite-sort by y, ensure batter doesn't slip behind dirt-circle layer.

## P3 — Future work

- [ ] **Steals & pickoffs** (issue S-13). New sub-module: `steal.ts` reads (R1 speed, pitcher hold, catcher pop time) → attempt + safe/out.
- [ ] **Box-score UI surface** for new behaviors (issue B-01). Show fouls-per-PA, R1→3B%, DP turns / opportunity.
- [ ] **Park factor validation** (issue B-03). Run 162-game cal across 5 different park configs; record HR/2B/3B per config.
- [ ] **CONFIG_V2 baseline doc**. Once recalibration lands, write a new baseline block in [config.ts](packages/sim-engine/src/config.ts) and update README "Calibration baseline" callout.

## Manual QA — Pre P1 Web Perf

- [ ] **Rotation page dynamic limits (L-03).** In dashboard rotation, verify save is blocked below 10 and above 12 assigned pitchers; confirm valid save at 10, 11, and 12.
- [ ] **Role constraints.** Confirm exactly 5 SP required, bullpen accepts 4-6 RP, and exactly 1 CL is required.
- [ ] **Roster page messaging.** Validate pitcher active-count banner shows valid range 10-12 and correctly warns on under/over states.
- [ ] **Slot mapping.** Confirm RP5/RP6 display labels for rotation slots 11 and 12 in roster and remain intact after save/reload.
- [ ] **Scheduled sim ingestion.** Run due/single scheduled game and verify no slot-11/12 pitchers are dropped from available bullpen.
- [ ] **Replay wall ricochet (R-04).** Load a persisted replay with wall contact and verify visible wall-hit segment followed by bounce-back travel.
- [ ] **Replay roll-to-stop (R-03).** On non-fielded balls, ensure animation continues to `restPoint` instead of stopping at `landingPoint`.
- [ ] **HR visual sanity (R-01/R-02).** Verify HR flights clear wall visually and runner path remains home → 1B → 2B → 3B → home.
- [ ] **Sim smoke guardrails.** Run `npm run sim -- --games 162 --seed 1` and verify rates stay within expected ranges.

## Manual QA — P1 Web Compile Perf

- [ ] **Stats capture sanity.** Start dev with `NEXT_WEBPACK_STATS_DIR=.next/perf-stats npm run dev -w apps/web` and verify `.stats.json` files are emitted under `.next/perf-stats`.
- [ ] **Benchmark protocol.** Run one cold pass and two warm passes with `benchmark-dev-routes.mjs` for `/`, `/dashboard`, and `/sim-lab-2`.
- [ ] **Module analysis report.** Run `analyze-webpack-stats.mjs` and confirm output highlights top compile-time modules and top fan-out modules.
- [ ] **Acceptance check.** Confirm warm pass 2 for `/sim-lab-2` stays at or below the criteria in `apps/web/perf/dev-compile-sim-lab-2.md`.

---

## In-Progress

_(none — pick from P0 or P1 above when starting a session)_

---

## Done

| Date       | Task                                                                                                   | Commit          |
| ---------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| 2026-05-06 | P1 web compile perf pass: stats instrumentation, analyzer workflow, and Sim Lab 2 prototype evaluation | _(uncommitted)_ |
| 2026-05-06 | P2 L-03 pass: dynamic pitcher roster rules (10-12 total, RP5/RP6 slots, UI+server+scheduler)           | _(uncommitted)_ |
| 2026-05-06 | P1 renderer pass: wall-hit timing from wall bounce speed + full roll-to-rest replay segment            | _(uncommitted)_ |
| 2026-05-06 | P1 S-12 validation pass: backup/cover responsibilities verified with added unit coverage               | _(uncommitted)_ |
| 2026-05-06 | P1 S-01 decision pass: keep doubles baseline near ~0.5 per team-game for now                           | _(uncommitted)_ |
| 2026-05-06 | P1 S-14 pass: PI-gated tag-up model (PI+speed+depth+arm)                                               | _(uncommitted)_ |
| 2026-05-06 | P1 S-15 pass: spray-aware r1→3rd (RF boost, LF hold; PI+speed gated)                                   | _(uncommitted)_ |
| 2026-05-06 | P1 S-10 pass: target-base decision tree (outs/runners/score-aware paths)                               | `8bb259d`       |
| 2026-05-06 | P0 calibration pass: expectedRanges rebased + foulPerContact guardrail + HR/FB keep decision           | `8f86cdb`       |
| 2026-05-06 | Persisted replay R/H/E: store game-level error totals and render E from DB                             | _(uncommitted)_ |
| 2026-05-06 | Replay stability pass: SSR-safe tick scene load + `simAll` direct service execution                    | _(uncommitted)_ |
| 2026-05-06 | Scheduled lineup 1-9/DH normalization + persisted replay innings/RHE + boxscore contrast fix           | _(uncommitted)_ |
| 2026-05-05 | Proxy/auth dev perf pass (matcher scoping, route classification, request user cache)                   | _(uncommitted)_ |
| 2026-05-05 | Sim Lab compile graph pass (engine subpath imports/exports, benchmark + test harness)                  | _(uncommitted)_ |
| 2026-04-29 | OF positions moved to 70 ft off wall, corner-carom penalty added                                       | _(uncommitted)_ |
| 2026-04-29 | Speed skill made dominant in fielder range model                                                       | _(uncommitted)_ |
| 2026-04-29 | Foul rate 0.58 → 0.45, foul push tightened to ±2° past foul line                                       | _(uncommitted)_ |
| 2026-04-29 | Richer PBP output (count+outs, runners, throws, dives, skill snapshot)                                 | _(uncommitted)_ |
| 2026-04-29 | README CONFIG documentation section                                                                    | _(uncommitted)_ |
| (prior)    | Wall ricochet engine math                                                                              | `4f30ed5`       |
| (prior)    | DP visualization                                                                                       | `1af3786`       |
| (prior)    | Flyball mid-flight teleport fix; ball sprite halved                                                    | `3c69d95`       |
| (prior)    | Grounder pop-back regression                                                                           | `15513b1`       |
