# Review: Testing

> **Review Date:** April 18, 2026  
> **Scope:** Test coverage, test infrastructure, testability assessment

---

## Summary

The project has **two smoke test scripts** but **no test framework**, no unit tests, no integration tests, and no E2E tests. The game engine's pure-function design makes it highly testable — this is a significant missed opportunity. No CI/CD pipeline exists to run tests automatically.

---

## Current Test Inventory

### `tests/seed-smoke-test.ts`

A standalone script (not a test framework test) that validates:

- Player generation produces correct counts (20 hitters, 20 pitchers per team)
- Attribute ranges are within expected bounds
- Max potential ≥ starting skill for all attributes
- Schedule generation produces correct number of rounds and games
- Home/away balance across the season

**Run method:** `npx tsx tests/seed-smoke-test.ts`  
**Output:** Console logs with expected/actual comparisons  
**Assertions:** Manual (no test runner, no pass/fail)

### `tests/smoke-test.ts`

A standalone script that validates:

- Game simulation produces a valid `GameResult`
- Final score has a winner (no ties)
- Innings count is ≥ 9
- Events array is populated (300+ entries)
- Outcome distribution analysis (% singles, doubles, HRs, walks, strikeouts, groundouts)

**Run method:** `npx tsx tests/smoke-test.ts`  
**Output:** Console logs with statistics  
**Assertions:** Manual (no test runner, no pass/fail)

---

## Findings

### 1. No Test Framework Installed

**Severity:** 🟠 HIGH

**Issue:** There is no test runner (Jest, Vitest, Mocha, etc.) in `package.json` or `devDependencies`. The existing smoke tests are standalone scripts that output to console and require manual inspection.

**Impact:**

- No automated pass/fail — a developer must read output and judge correctness
- No integration with CI/CD
- No coverage reporting
- Tests can't be run as part of `npm test`

**Recommendation:** Install Vitest (fast, TypeScript-native, Vite-compatible):

```bash
npm install -D vitest @vitest/coverage-v8
```

Add to `package.json`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

---

### 2. Game Engine is Highly Testable But Untested

**Severity:** 🟠 HIGH  
**Directory:** `src/lib/sim-engine/`

**Issue:** The game engine's architecture is ideal for testing — pure functions with no side effects or database dependencies:

| Function                            | Input                             | Output                    | Testable?  |
| ----------------------------------- | --------------------------------- | ------------------------- | ---------- |
| `resolveAtBat(hitter, pitcher)`     | Two threshold objects             | `{ outcome, roll }`       | ✅ Perfect |
| `calculateHitterSkill(skills)`      | Player attributes (numbers)       | Probability thresholds    | ✅ Perfect |
| `calculatePitcherSkill(skills, bf)` | Player attributes + batters faced | Probability thresholds    | ✅ Perfect |
| `Field.baseSequence(outcome)`       | At-bat outcome enum               | Play descriptions + state | ✅ Perfect |
| `simulateGame(visitor, home)`       | Two team objects                  | Full game result          | ✅ Perfect |

**None of these have unit tests.**

**Recommended test cases:**

```typescript
// AtBat tests
describe('resolveAtBat', () => {
  it('returns a valid AtBatOutcome', () => { ... });
  it('respects cumulative threshold boundaries', () => { ... });
  it('uses pitcher thresholds when pitcher dominates', () => { ... });
  it('uses hitter thresholds when hitter dominates', () => { ... });
});

// PlayerSkills tests
describe('calculateHitterSkill', () => {
  it('produces non-negative thresholds for minimum skills', () => { ... });
  it('produces thresholds summing to <= 1.0', () => { ... });
  it('higher avg skill increases hit probability', () => { ... });
  it('higher power skill increases HR probability', () => { ... });
});

describe('applyStaminaDecay', () => {
  it('returns unchanged skills below fatigue threshold', () => { ... });
  it('degrades skills above fatigue threshold', () => { ... });
  it('never produces negative skill values', () => { ... });
});

// Field tests
describe('Field.baseSequence', () => {
  it('scores runner from third on a single', () => { ... });
  it('clears bases on a home run', () => { ... });
  it('advances runners on a walk with bases loaded', () => { ... });
  it('records an out on a ground out', () => { ... });
});

// Integration: full game
describe('simulateGame', () => {
  it('produces a winner', () => { ... });
  it('plays at least 9 innings', () => { ... });
  it('handles extra innings correctly', () => { ... });
  it('detects walk-off wins', () => { ... });
  it('tracks stats for all players who batted', () => { ... });
});
```

---

### 3. Financial Operations Completely Untested

**Severity:** 🟠 HIGH  
**Files:** `src/lib/finance/budget.ts`

**Issue:** Budget operations — the most concurrency-sensitive code in the application — have zero tests:

- `checkBudget()` — verifies team can afford a cost
- `recordTransaction()` — debits/credits with transaction logging
- `calculatePlayerValue()` — determines player signing cost
- `calculateGameRevenue()` — revenue per game type

These are pure logic functions that could easily be unit tested:

```typescript
describe('calculatePlayerValue', () => {
  it('returns $22,000 × skill total', () => {
    const player = { speed: 5, stamina: 5, ... };  // total = 45
    expect(calculatePlayerValue(player)).toBe(990000);
  });
});

describe('calculateGameRevenue', () => {
  it('returns correct regular game revenue', () => { ... });
  it('returns higher playoff revenue', () => { ... });
});
```

---

### 4. Trade Execution Untested

**Severity:** 🟡 MEDIUM  
**File:** `src/lib/trades/execute.ts`

**Issue:** `executeTrade()` is the most complex multi-step business operation — it moves players between teams, transfers cash, updates statuses, logs transactions, and auto-rejects competing offers. No tests exist.

**Risk:** The roster validation is already known to be approximate (see Correctness review). Without tests, regressions in trade logic would go undetected.

---

### 5. No API Integration Tests

**Severity:** 🟡 MEDIUM  
**Scope:** All 18 API routes

**Issue:** No tests verify that API routes:

- Return correct status codes for valid/invalid requests
- Properly authenticate/authorize
- Handle edge cases (e.g., signing a player another team just signed)
- Return correct response shapes

**Recommendation:** Use Vitest with `next/test-utils` or a lightweight HTTP testing approach:

```typescript
describe('POST /api/market/sign', () => {
  it('returns 401 without auth', () => { ... });
  it('returns 400 with invalid playerId', () => { ... });
  it('returns 400 with insufficient funds', () => { ... });
  it('returns 200 and moves player to team', () => { ... });
});
```

---

### 6. No E2E Tests

**Severity:** 🟡 MEDIUM  
**Scope:** Full application

**Issue:** No Playwright or Cypress tests verify user workflows:

- Sign up → Create team → View roster
- Set lineup → Simulate game → View results
- List player → Receive offer → Accept trade

**Recommendation:** Start with 3-5 critical path tests using Playwright:

```typescript
test("user can create team and view roster", async ({ page }) => {
  await page.goto("/signup");
  // ... sign up flow
  await page.goto("/dashboard/roster");
  await expect(page.locator("table")).toHaveCount(2); // Hitters + Pitchers
});
```

---

### 7. No CI/CD Pipeline

**Severity:** 🟡 MEDIUM  
**Scope:** Repository

**Issue:** No GitHub Actions, no GitLab CI, no build/test automation. Code is pushed directly to the repository with no automated checks.

**Recommendation:** Add `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

---

## Testability Assessment

### Easy to Test (Pure Functions)

| Module                         | Functions                                                            | Effort    |
| ------------------------------ | -------------------------------------------------------------------- | --------- |
| `sim-engine/AtBat.ts`          | `resolveAtBat`                                                       | 1-2 hours |
| `sim-engine/PlayerSkills.ts`   | `calculateHitterSkill`, `calculatePitcherSkill`, `applyStaminaDecay` | 2-3 hours |
| `sim-engine/Field.ts`          | `baseSequence`, runner advancement                                   | 3-4 hours |
| `sim-engine/GameEngine.ts`     | `simulateGame` (integration)                                         | 2-3 hours |
| `lib/finance/budget.ts`        | `calculatePlayerValue`, `calculateGameRevenue`                       | 1 hour    |
| `lib/seed/generate-players.ts` | `generateRoster`, `generateSchedule`                                 | 2 hours   |
| `lib/training/run.ts`          | Skill improvement logic                                              | 1-2 hours |

**Total estimate for comprehensive unit tests: ~15-20 hours**

### Harder to Test (DB-Dependent)

| Module                           | Challenge                  | Approach                            |
| -------------------------------- | -------------------------- | ----------------------------------- |
| `sim/persist-game.ts`            | 9-step DB pipeline         | Mock Supabase client or use test DB |
| `trades/execute.ts`              | Multi-table mutations      | Test DB with seed data              |
| `provisioning/provision-team.ts` | League fill + schedule gen | Test DB                             |
| API routes                       | Full request lifecycle     | Supertest or Playwright             |

---

## Recommended Test Strategy

### Phase 1: Unit Tests (Week 1)

- Install Vitest
- Test all `sim-engine/` pure functions
- Test `finance/` calculation functions
- Test `training/` skill improvement logic
- **Target: 80% coverage on pure business logic**

### Phase 2: Integration Tests (Week 2-3)

- Test API routes with mocked auth
- Test trade execution flow
- Test game persistence pipeline
- **Target: All API routes have at least one happy-path test**

### Phase 3: E2E Tests (Week 4+)

- Install Playwright
- Test 5 critical user flows
- **Target: Signup → Game Sim → View Results flow automated**

### Phase 4: CI/CD (Alongside Phase 1)

- GitHub Actions: lint → build → test on every push
- Coverage reporting
- **Target: No code merges without passing tests**

---

## Summary Table

| #   | Finding                                  | Severity | Category       |
| --- | ---------------------------------------- | -------- | -------------- |
| 1   | No test framework installed              | HIGH     | Infrastructure |
| 2   | Game engine highly testable but untested | HIGH     | Coverage Gap   |
| 3   | Financial operations untested            | HIGH     | Coverage Gap   |
| 4   | Trade execution untested                 | MEDIUM   | Coverage Gap   |
| 5   | No API integration tests                 | MEDIUM   | Coverage Gap   |
| 6   | No E2E tests                             | MEDIUM   | Coverage Gap   |
| 7   | No CI/CD pipeline                        | MEDIUM   | Automation     |
