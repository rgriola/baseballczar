# Issues

> Active bug log for Baseball Czar v2. New issues go to the top of the
> relevant section. When fixed, move to **Resolved** with the commit
> SHA. Use the `Status` column to track triage state.

**Legend:** `🔴 P0` = blocks calibration / correctness · `🟠 P1` = visible
gameplay defect · `🟡 P2` = polish / cosmetic · `🔵 P3` = nice-to-have

---

## 🔴 Sim Engine — open

| ID   | Status | Title                                                                             | Notes                                                                                                                                   |
| ---- | ------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | open   | Doubles per team-game far below MLB (~0.18 vs MLB ~1.5)                           | OF starting positions + spray distribution leave too few balls in the gap. Speed model fixed; spray distribution still pulls too tight. |
| S-02 | open   | Triples per team-game = 0.00 (MLB ~0.04)                                          | Corner-carom penalty added (`cornerCaromPenaltySec` 0.6) but very few balls land at \|spray\|>36° to trigger it.                        |
| S-03 | open   | HR/FB ~0.21 (target 0.10–0.14)                                                    | `powerToExitVeloMph` was bumped 67→75/106→115. Reverting brings HRs in range; user deferred this fix.                                   |
| S-04 | open   | `foulsPerPa` 0.82, below MLB band [1.2, 1.8] but `foulPerContact` ~51% (MLB ~40%) | Ratio is wrong even though the per-PA rate is low. `expectedRanges` only checks per-PA, not per-contact.                                |
| S-05 | open   | `expectedRanges` calibrated against the old broken model                          | After the foul/spray/speed fixes most ranges fail by definition. Whole band needs a re-baseline pass.                                   |

## 🟠 Sim Engine — gameplay logic gaps

| ID   | Status | Title                                                 | Notes (from `first-file.md` Apr 28+)                                                                                                 |
| ---- | ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| S-10 | open   | Fielders don't choose target base by runner condition | Currently always throws to 1B (IF) or to the lead-runner cutoff. No DP read, no "look the runner back," no score-aware throw choice. |
| S-11 | open   | No score-aware fielding                               | Up by 5 with a R3, OF should throw to 2B not home. Engine has no margin-aware decision.                                              |
| S-12 | open   | Pitcher / 1B don't back up bases                      | First-baseman should cover 1B on 4-6-3; pitcher should back up home/3B on extra-base hits.                                           |
| S-13 | open   | No steals / pickoffs                                  | Engine has no steal sub-module. Speed skill currently only affects sprint times to base.                                             |
| S-14 | open   | Tag-up `sacFlyTagProb` is a flat constant             | Should be PI + speed gated (per `first-file.md`).                                                                                    |
| S-15 | open   | Spray-aware r1→3rd difficulty missing                 | A single to RF should make R1→3B much easier than a single to LF; engine treats both the same.                                       |
| S-16 | open   | PI (Play Intelligence) only partially wired           | Used in some defensive decisions; not consistently used for runner advances, cutoff choice, or tag-ups.                              |

## 🟠 Renderer / Web sim-v2

| ID   | Status | Title                                             | Notes                                                                                                           |
| ---- | ------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| R-01 | open   | Ball visually doesn't clear the fence on some HRs | E.g. `Contact: 105 mph, LA 24°, spray -41°, 364 ft, apex 62 ft — HR!` — wall geometry vs. pixel rounding.       |
| R-02 | open   | Batter/runner doesn't touch all bases on HR trot  | Path goes around the mound on some HRs; fixed once already (commit re: HR trot) but regression reported Apr 17. |
| R-03 | open   | Ball doesn't roll to a stop                       | Ball-roll event terminates early; renderer cuts off the rest segment.                                           |
| R-04 | open   | Ball doesn't bounce off the wall in the renderer  | Engine emits `wallHitPoint` + `wallBounceSpeedFps`; renderer ignores them — needs to play the ricochet segment. |
| R-05 | open   | Batter sprite disappears in some camera angles    | Likely sprite-sort layer bug.                                                                                   |
| R-06 | open   | Fielders appear to "speed up" when chasing        | User suspects zone-based snap. Need to confirm sprite tween uses constant ft/sec, not eased curve.              |

## 🟡 Roster / lineup

| ID   | Status | Title                                                     | Notes                                                      |
| ---- | ------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| L-01 | open   | Starting pitchers not rotated through the season          | No SP1→SP2→… tracking; same starter every game.            |
| L-02 | open   | No closer (`CL`) position; bullpen treated as a flat pool | Need CL designation; sim uses CL late-game in close games. |
| L-03 | open   | Pitcher roster needs to enforce 10 pitchers (5 SP + 5 RP) | Rotation page should show all 10.                          |

## 🔵 Backlog

| ID   | Status | Title                                            |
| ---- | ------ | ------------------------------------------------ |
| B-01 | open   | Box-score / sim-lab UI surface for new behaviors |
| B-02 | open   | Foul-out rate validation against MLB             |
| B-03 | open   | Park factor validation per stadium               |

---

## ✅ Resolved

| ID  | Resolved In   | Title                                                                |
| --- | ------------- | -------------------------------------------------------------------- |
| —   | (uncommitted) | Speed skill now dominates fielder range (was defense-dominant)       |
| —   | (uncommitted) | Corner-carom penalty added for OF retrieving balls down the lines    |
| —   | (uncommitted) | OF starting positions moved in to ~70 ft off wall                    |
| —   | (uncommitted) | Foul rate dropped 0.58 → 0.45; foul push tightened to ±2° past line  |
| —   | (uncommitted) | `extraBaseSlackSec` neutralized so doubles/triples come from physics |
| —   | `15513b1`     | Grounder pop-back regression                                         |
| —   | `3c69d95`     | Flyball mid-flight teleport; ball sprite halved                      |
| —   | `1af3786`     | DP visualization                                                     |
| —   | `4f30ed5`     | Roll tuning + wall ricochet (engine side)                            |
