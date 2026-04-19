# Review: Correctness & Logic

> **Review Date:** April 18, 2026  
> **Scope:** Game engine logic, business rules, edge cases

---

## Summary

The core game simulation engine is well-structured and produces reasonable baseball results. However, several logic issues could lead to unrealistic outcomes, inconsistent stats, or broken game states. Most are medium-severity — they won't crash the app but will affect gameplay quality.

---

## Findings

### 1. At-Bat Resolution: Winner-Take-All Threshold Selection

**Severity:** MEDIUM  
**File:** `src/lib/sim-engine/AtBat.ts`

**Issue:** The at-bat resolution compares pitcher vs hitter total skill to decide which player's full probability table to use. The "loser" of the dominance check has zero influence on the outcome.

```typescript
const ratio = pitcherThresholds.TOT / hitterThresholds.TOT;
const dominantThresholds =
  ratio >= 1
    ? pitcherThresholds // Pitcher is stronger — use ONLY pitcher's table
    : hitterThresholds; // Batter is stronger — use ONLY batter's table
```

**Impact:** A pitcher with TOT=30 vs a hitter with TOT=29 produces the exact same result as TOT=30 vs TOT=1. In real baseball, matchups are a blend — a great hitter still gets hits off a great pitcher. This creates a cliff-effect where small skill differences cause dramatic outcome swings.

**Recommendation:** Blend both probability tables using a weighted average based on the ratio, e.g.:

```typescript
const weight = ratio / (1 + ratio); // Smooth 0–1 scale
// Interpolate each threshold: pitcher_val * weight + hitter_val * (1 - weight)
```

---

### 2. Pitcher Substitution: Random Re-Selection Bug

**Severity:** MEDIUM  
**File:** `src/lib/sim-engine/GameEngine.ts`

**Issue:** When the starting pitcher fatigues (30+ batters faced and runners on base), a reliever is selected randomly from the bullpen. However:

- The same reliever can be picked multiple times across different at-bats
- There's no tracking of which relievers have already pitched
- A fresh reliever could be replaced by a tired one if the random pick lands on a previously-used pitcher

```typescript
if (pBox.bf >= 30 && runnersOnBase >= 1) {
  const relieverIdx =
    1 + Math.floor(Math.random() * Math.min(bullpen.length - 1, 9));
  return relieverIdx;
}
```

NOTE: In Baseball once a player (hitter/fielder or Pitcher) leaves the game they cannot return into the game.

- exception : In baseball a Pitcher may move to another position - this was common at the beginning of professoinal baseball and still is in amateaur baseball - then move back to pitching as long as they do not leave the game. Their place in the batting order always remains the same. In this game Pitchers do not hit, the "DH"
  designated hitter hits for the pitchers place in the lineup. In baseball a pitcher is allowed to hit OR the manager may use a designated hitter for them, the latter is more popular today.

**Impact:** Unrealistic pitching patterns. A manager would never bring a reliever in, take them out, then bring them back.

**Recommendation:** Track a `usedRelievers` set. Once a reliever enters, mark them as used. Pick from unused relievers only.

---

### 3. Player Skills Can Start at Zero

**Severity:** MEDIUM  
**File:** `src/lib/seed/generate-players.ts`

**Issue:** Skill generation uses `Math.floor(Math.random() * 7)` which produces values 0–6. A player with `speed=0`, `avg=0`, or `eye=0` would produce degenerate probability thresholds in the skill math (potentially negative or NaN values).

NOTE: They should have a minmium value, 0 is not really zero.

```typescript
// Skills generated in range [0, 6]
const speed = Math.floor(Math.random() * 7);
```

But `PlayerSkills.ts` formulas assume skills are 1–10:

```typescript
const xAVG = skills.avg * 0.007 + 0.1; // avg=0 → 0.1 (barely functional)
const xSPEED = skills.speed * 0.002 + 0.003; // speed=0 → 0.003 (near zero)
```

**Impact:** Players with zero skills produce near-zero probabilities for certain outcomes. While not a crash, it creates players who essentially can't perform.

**Recommendation:** Generate skills in range [1, 7] using `1 + Math.floor(Math.random() * 7)`.

---

### 4. Trade Roster Validation is Approximate

**Severity:** MEDIUM  
**File:** `src/lib/trades/execute.ts`

**Issue:** The trade execution does a "rough check" on roster composition post-trade but doesn't rigorously validate that the final roster meets all minimums.

The code checks:

- Total roster ≤ 40 for both teams
- But the fielder/pitcher balance check only logs warnings — it doesn't block the trade

**Impact:** A team could end up with fewer than 9 hitters or no pitchers, making them unable to field a team for simulation. The sim would then throw errors when loading rosters.

**Recommendation:** Add hard validations:

- Buyer must have ≥ 9 active fielders after trade
- Buyer must have ≥ 1 active pitcher after trade
- Same checks for seller

---

### 5. Market Signing Cost vs Salary Inconsistency

**Severity:** LOW  
**File:** `src/lib/trades/execute.ts`, `src/app/api/market/sign/route.ts`

**Issue:** When signing a free agent, the cost is calculated as `$22,000 × sum_of_all_skills`. But players also have a `salary` column that's set during generation and used nowhere in the signing flow.

```typescript
// Signing cost formula
const value = 22000 * (speed + stamina + play_intel + avg + strength + eye + bunting + throw + fielding);
```

The `salary` field on the player record is a separate number set during seed, not derived from skills, and not used during market operations.

**Impact:** Confusing — the roster page shows a "Salary" column that has no bearing on what it costs to sign a player. Users would expect these to be related.

**Recommendation:** Either derive salary from the same formula used for signing cost, or use the salary field as the signing cost. They should be consistent.

---

### 6. ERA Calculation: Mixed IP Formats

**Severity:** LOW  
**File:** `src/app/dashboard/leaders/page.tsx`, `src/app/dashboard/stats/page.tsx`

**Issue:** Baseball uses a special notation for innings pitched: 6.2 means 6 and 2/3 innings (not 6.2 decimal innings). The codebase has an `ipToInnings()` helper that converts baseball notation to true decimal, but it's not consistently applied.

```typescript
// Correct conversion exists:
function ipToInnings(ip: number): number {
  const whole = Math.floor(ip);
  const frac = Math.round((ip - whole) * 10);
  return whole + frac / 3;
}
```

If any ERA calculation uses raw IP (baseball notation) as a divisor without converting, the result will be wrong. For example: 6.2 IP with 3 ER:

- Correct: ERA = (3 / 6.667) × 9 = 4.05
- Wrong: ERA = (3 / 6.2) × 9 = 4.35

**Impact:** Slightly incorrect ERA display on stats/leaders pages.

**Recommendation:** Audit all ERA calculations to ensure they use `ipToInnings()` before dividing.

NOTE: yes baseball calculations ie: ERA + IP etc, need a centralization for calculations, not file by file. Also batting average displayed never includes the 0 ie; 0.275, it is always dispalyed .275

---

### 7. Standings Unique Constraint Missing season_no

**Severity:** HIGH  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** The standings table has a unique constraint on `(league_id, team_id)` but not `(league_id, team_id, season_no)`. This means if a second season is ever started, inserting new standings rows for the same team would violate the constraint — or worse, the upsert would overwrite season 1 data.

```sql
-- Current (problematic):
create unique index idx_standings_unique on public.standings(league_id, team_id);

-- Should be:
create unique index idx_standings_unique on public.standings(league_id, team_id, season_no);
```

**Impact:** Multi-season play is broken. Starting a second season would either fail or corrupt first-season standings.

**Recommendation:** Add a migration to fix the unique index to include `season_no`.

---

### 8. Training Age Cutoff is Abrupt

**Severity:** LOW  
**File:** `src/lib/training/run.ts`

**Issue:** Players aged 30+ have their age factor set to 0, meaning training produces zero improvement. This is an abrupt cliff:

- Age 29: can train (factor 0.015)
- Age 30: cannot train at all (factor 0)

```typescript
const ageFactor = age <= 22 ? 0.04 : age <= 26 ? 0.025 : age <= 29 ? 0.015 : 0;
```

**Impact:** In real baseball, players in their early 30s can still improve modestly. The hard cutoff makes age-30 players immediately worthless for training investment, which could frustrate players.

**Recommendation:** Add a gradual decline: age 30–33 → 0.005, age 34+ → 0. Or introduce a small chance of decline for older players (regression).

---

### 9. Walk-Off Detection Has Redundant Check

**Severity:** LOW  
**File:** `src/lib/sim-engine/GameEngine.ts`

**Issue:** The walk-off detection in the bottom of the 9th (or later) checks `outs < 3` in the condition, but the loop already exits at 3 outs. The check is technically correct but logically redundant — if outs reached 3, the `for` loop would have ended.

**Impact:** No functional bug, but adds confusion when reading the code. NOTE: YES! I did that and was afraid to remove it in the original Java Sim! you find my bug.

---

### 10. Ground-Out Runner Advancement With 2 Outs

**Severity:** LOW  
**File:** `src/lib/sim-engine/Field.ts`

**Issue:** On a ground out, runners advance when there are fewer than 2 outs (fielder's choice scenarios). With 2 outs, the runner on third scores on the throw to first — this is modeled as a "wild pitch" scenario. This is a simplification but may produce slightly higher scoring than expected. (NOTE: yes this is incorrect, with 2 outs for any further runs to count the batter much be safe at first base ie; runner at 3rd base, batter hits and tries to get to second base, already touching and passing first base the run will count. Runner at 3rd - batter hits a ground ball and is thrown out at first run does not count even if the Runner at 3rd crosses the plate (home plate) prior to the batter being thrown out at first. )

**Impact:** Minor statistical inflation of runs scored. Acceptable for a simulation game but worth noting. NOTE: I think I remember this issue.

---

## Summary Table

| #   | Finding                                      | Severity | Type           |
| --- | -------------------------------------------- | -------- | -------------- |
| 1   | At-bat winner-take-all threshold selection   | MEDIUM   | Game Balance   |
| 2   | Pitcher re-selection from bullpen            | MEDIUM   | Realism        |
| 3   | Player skills can be zero                    | MEDIUM   | Data           |
| 4   | Trade roster validation approximate          | MEDIUM   | Business Logic |
| 5   | Signing cost vs salary mismatch              | LOW      | Consistency    |
| 6   | ERA mixed IP formats                         | LOW      | Calculation    |
| 7   | Standings missing season_no in unique key    | HIGH     | Data           |
| 8   | Training age 30+ hard cutoff                 | LOW      | Game Design    |
| 9   | Walk-off redundant check                     | LOW      | Code Clarity   |
| 10  | Ground-out runner advancement simplification | LOW      | Realism        |
