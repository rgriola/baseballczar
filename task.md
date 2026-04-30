# Tasks

> Active task backlog. New work goes under the matching priority bucket.
> When a task starts, mark it `in-progress`; when done, move to **Done**
> with the commit SHA.

**Priorities:** `P0` ship-blocking · `P1` next sprint · `P2` polish ·
`P3` someday

---

## P0 — Calibration & correctness

- [ ] **Recalibrate `expectedRanges`** to the post-foul-fix model. Run a 162-game @ seed 1 sim, capture rates, widen/tighten bands so a clean run is all-green. Keep the old bands as a comment for reference.
- [ ] **Decide on HR/FB fix**: revert `powerToExitVeloMph` to `{67, 106}` or accept the higher EV and adjust `dragCoeff` upward to keep distance in line.
- [ ] **Add `foulPerContact` guardrail** to `expectedRanges` + `report.ts` so a future spray tweak can't silently push the foul ratio out of MLB range.
- [ ] **Commit current foul/triples work** as one atomic commit ("sim: speed-dominant range, corner caroms, foul rate 0.45, OF positions").

## P1 — Sim engine gameplay logic

- [ ] **Fielder target-base decision tree** (issue S-10). Branch on `(outs, runners, hitLocation, hitType, scoreMargin)`. Start with the standard tree from `first-file.md`:
  - 0 out, R1, grounder to MIF → DP attempt (2B → 1B)
  - 2 outs, any → easy out at 1B
  - R3 with < 2 outs → look runner back, throw 1B
  - Score-aware: lead ≥ 5 runs → throw to 2B not home
- [ ] **Spray-aware r1→3rd** (issue S-15). RF singles raise the advance probability; LF singles lower it. PI + speed gated.
- [ ] **PI-gated tag-up** (issue S-14). Replace flat `sacFlyTagProb` with `f(PI, speed, depth, defense.arm)`.
- [ ] **Pitcher / 1B backup logic** (issue S-12). 1B covers 1B on 4-6-3 (already done), 2B at 2B for SS field, etc. Pitcher backs up home/3B on extra-base hits.
- [ ] **Doubles distribution work** (issue S-01). Options on the table:
  - widen `sprayStdDevDeg` 18 → 22 (more line traffic, side effect: more fouls/HRs)
  - reduce OF range by 5% on balls landing in the LCF/RCF gaps
  - or stop chasing the 1.5/g number and accept ~0.5/g for now

## P1 — Renderer / sim-v2

- [ ] **Wall ricochet visualization** (issue R-04). Renderer must consume `wallHitPoint` + `wallBounceSpeedFps` and play the ricochet segment.
- [ ] **Ball roll-to-stop** (issue R-03). Tween must complete the full `restPoint` segment, not cut off at landing.
- [ ] **HR clearance pixel rounding** (issue R-01). Wall sprite vs. ball-z math; verify ball is drawn above wall when `apex > wallHeightFt`.
- [ ] **HR trot path regression** (issue R-02). Make sure the HR trot waypoint list is `home → 1B → 2B → 3B → home`, not collapsed to mound.

## P2 — Roster / lineup

- [ ] **Starter rotation** (issue L-01). Track `team.nextStarterIdx`; cycle SP1→SP5 across schedule.
- [ ] **Closer (`CL`) position** (issue L-02). Add `CL` to the position enum, surface on rotation page, route late-inning + close-game appearances to CL.
- [ ] **10-pitcher roster enforcement** (issue L-03). 5 SP + 5 RP; rotation page shows all 10.

## P2 — Renderer polish

- [ ] **Fielder pursuit easing** (issue R-06). Confirm sprite tween uses linear ft/sec from converge event; remove any easing curve.
- [ ] **Batter sprite z-order** (issue R-05). Sprite-sort by y, ensure batter doesn't slip behind dirt-circle layer.

## P3 — Future work

- [ ] **Steals & pickoffs** (issue S-13). New sub-module: `steal.ts` reads (R1 speed, pitcher hold, catcher pop time) → attempt + safe/out.
- [ ] **Box-score UI surface** for new behaviors (issue B-01). Show fouls-per-PA, R1→3B%, DP turns / opportunity.
- [ ] **Park factor validation** (issue B-03). Run 162-game cal across 5 different park configs; record HR/2B/3B per config.
- [ ] **CONFIG_V2 baseline doc**. Once recalibration lands, write a new baseline block in [config.ts](packages/sim-engine/src/config.ts) and update README "Calibration baseline" callout.

---

## In-Progress

_(none — pick from P0 or P1 above when starting a session)_

---

## Done

| Date       | Task                                                                   | Commit          |
| ---------- | ---------------------------------------------------------------------- | --------------- |
| 2026-04-29 | OF positions moved to 70 ft off wall, corner-carom penalty added       | _(uncommitted)_ |
| 2026-04-29 | Speed skill made dominant in fielder range model                       | _(uncommitted)_ |
| 2026-04-29 | Foul rate 0.58 → 0.45, foul push tightened to ±2° past foul line       | _(uncommitted)_ |
| 2026-04-29 | Richer PBP output (count+outs, runners, throws, dives, skill snapshot) | _(uncommitted)_ |
| 2026-04-29 | README CONFIG documentation section                                    | _(uncommitted)_ |
| (prior)    | Wall ricochet engine math                                              | `4f30ed5`       |
| (prior)    | DP visualization                                                       | `1af3786`       |
| (prior)    | Flyball mid-flight teleport fix; ball sprite halved                    | `3c69d95`       |
| (prior)    | Grounder pop-back regression                                           | `15513b1`       |
