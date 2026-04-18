# Review: Readability & Maintainability

> **Review Date:** April 18, 2026  
> **Scope:** Code organization, naming, conventions, documentation, technical debt

---

## Summary

The codebase follows clean Next.js App Router conventions with consistent TypeScript strict mode. File organization is logical and the separation between pure game engine and database orchestration is excellent. The main concerns are **magic numbers in skill calculations**, **a few oversized files**, and a **small name pool** for player generation.

---

## Findings

### 1. Magic Numbers in Skill Threshold Calculations

**Severity:** 🟡 MEDIUM  
**File:** `src/lib/sim-engine/PlayerSkills.ts`

**Issue:** The skill-to-probability conversion uses numerous unexplained constants:

```typescript
const xAG = skills.ag * 0.025 + 0.1;
const xAVG = skills.avg * 0.007 + 0.1;
const xPOWER = skills.power * 0.025 + 0.05;
const xEYE = skills.eye * 0.03 + 0.15;
const xDHR = skills.dhr * 0.05 + 0.35;
const xSPEED = skills.speed * 0.002 + 0.003;
```

What do 0.025, 0.007, 0.1, 0.05, 0.35, 0.003 represent? These are tuning parameters that directly control game outcomes but are buried in arithmetic expressions with no documentation.

**Recommendation:** Extract to named constants:

```typescript
const SKILL_COEFFICIENTS = {
  AG_MULTIPLIER: 0.025,
  AG_BASE: 0.1,
  AVG_MULTIPLIER: 0.007,
  AVG_BASE: 0.1,
  // ... etc
} as const;
```

Similarly, the pitcher fatigue lookup tables in `PlayerSkills.ts` are well-structured — the same pattern should be applied to hitter threshold math.

---

### 2. Oversized Files

**Severity:** 🟡 MEDIUM  
**Files:**

| File                                 | Lines | Concern                                      |
| ------------------------------------ | ----- | -------------------------------------------- |
| `src/lib/sim/persist-game.ts`        | ~450  | 9 different persistence concerns in one file |
| `src/lib/sim-engine/GameEngine.ts`   | ~360  | Main loop + initialization + finalization    |
| `src/lib/sim-engine/Field.ts`        | ~350  | Baserunning state machine                    |
| `src/app/dashboard/leaders/page.tsx` | ~200  | 10 category definitions + layout             |

**Recommendation:** `persist-game.ts` could be split into:

- `persist-game-record.ts` — Steps 1-2 (game + events)
- `persist-player-stats.ts` — Steps 3-6 (game + season stats)
- `persist-standings.ts` — Steps 7-8 (standings + schedule)
- `persist-revenue.ts` — Step 9 (financial transactions)

The engine files are more acceptable at their sizes since they contain cohesive logic.

---

### 3. Small Name Pool (43 Names for 240+ Players)

**Severity:** 🟢 LOW  
**Files:** `supabase/migrations/002_seed_names.sql`, `src/lib/seed/data.ts`

**Issue:** The name pool has 43 first names and 43 last names. With 6 teams × 40 players = 240 players, there will be significant name collisions. Players named "Mike Johnson" could appear on multiple teams.

The names are also duplicated — once in the SQL migration and once in a TypeScript data file.

**Recommendation:** Expand to at least 200 first names and 200 last names. This gives 40,000 unique combinations, making collisions rare for a 6-team league. Remove the TypeScript duplicate.

---

### 4. Consistent Code Patterns (Positive)

**Severity:** N/A — Observations

The codebase consistently follows good patterns:

**File organization:**

- Pages in `src/app/dashboard/[feature]/page.tsx`
- Server actions in `src/app/dashboard/actions.ts`
- Client components co-located with their page (e.g., `roster-toggle.tsx` in `roster/`)
- Business logic in `src/lib/[domain]/`
- API routes in `src/app/api/[resource]/route.ts`

**TypeScript:**

- Strict mode enabled
- `db-types.ts` defines all database row types
- Zod schemas for input validation (not just TS types)
- Type-safe Supabase client with `Database` generic

**Component patterns:**

- Server Components by default (data fetching at page level)
- Client Components only for interactivity (`'use client'` directive)
- `useTransition` for non-blocking mutations
- `router.refresh()` after mutations to reload server data

**API patterns:**

- Consistent error response shape: `{ error: string }` or `{ success: true }`
- Zod validation → Auth check → Ownership verification → Business logic → DB mutation
- HTTP status codes used correctly

---

### 5. Inconsistent Naming in a Few Places

**Severity:** 🟢 LOW  
**Scope:** Various files

| Location                             | Issue                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `GateReceipts.ts` has `advertisment` | Typo: should be `advertisement`                                        |
| DB column `dhr`                      | Not obvious what this means (Double-HomeRun ratio?) — no documentation |
| `play_intel` vs `pitchIntel`         | Same concept, different names in DB vs engine                          |
| `ag` column                          | Unclear abbreviation — agility? aggressiveness?                        |
| `b2`, `b3` in stats                  | Abbreviations for doubles/triples — could be `doubles`, `triples`      |

**Recommendation:** Add a data dictionary (or JSDoc comments) for abbreviated column names. The abbreviations are fine for database columns (standard in baseball data) but need documentation for new developers.

---

### 6. Dual Data Sources for Seed Names

**Severity:** 🟢 LOW  
**Files:** `supabase/migrations/002_seed_names.sql`, `src/lib/seed/data.ts`

**Issue:** The same 43 names exist in both a SQL migration file and a TypeScript constants file. If one is updated without the other, they drift out of sync.

**Recommendation:** Choose one source of truth:

- Use the SQL migration for initial DB seeding
- Use the TypeScript file for runtime player generation
- Delete whichever is not needed for its purpose, or generate one from the other

---

### 7. Dashboard Navigation Has 13 Links

**Severity:** 🟢 LOW  
**File:** `src/app/dashboard/layout.tsx`

**Issue:** The horizontal nav has 13 links in a scrollable row:

```
Front Office | Roster | Lineup | Rotation | Stats | Schedule |
Standings | Leaders | Finance | Market | Trades | Training | O2O
```

On narrow screens, the `overflow-x-auto` allows horizontal scrolling, but 13 items in a horizontal nav is dense.

**Recommendation:** Consider grouping into categories in a future UI refresh:

- **Team:** Roster, Lineup, Rotation
- **League:** Schedule, Standings, Leaders, Stats
- **Business:** Finance, Market, Trades, Training
- **Special:** O2O (Challenges)

---

### 8. No README Documentation (Was Boilerplate)

**Severity:** 🟡 MEDIUM  
**File:** `README.md`

**Issue:** The README is the default create-next-app template with no project-specific information. New developers would have no idea what this project is, how to set it up, or how it's structured.

**Recommendation:** Being addressed as part of this review — see updated README.

---

## Code Quality Metrics

| Metric                    | Value                                | Assessment       |
| ------------------------- | ------------------------------------ | ---------------- |
| TypeScript strict mode    | ✅ Enabled                           | Good             |
| ESLint                    | ✅ Configured                        | Good             |
| Consistent file structure | ✅ Next.js App Router conventions    | Good             |
| Type safety               | ✅ Zod + TypeScript generics         | Good             |
| Separation of concerns    | ✅ Pure engine / orchestration / API | Excellent        |
| Documentation             | ❌ No JSDoc, no README               | Needs work       |
| Magic numbers             | ⚠️ In skill calculations             | Needs extraction |
| File sizes                | ⚠️ A few 350-450 line files          | Acceptable       |
| Dead code                 | ✅ Minimal (recently cleaned)        | Good             |
| Naming consistency        | ⚠️ Minor inconsistencies             | Acceptable       |

---

## Summary Table

| #   | Finding                                  | Severity | Category      |
| --- | ---------------------------------------- | -------- | ------------- |
| 1   | Magic numbers in skill calculations      | MEDIUM   | Documentation |
| 2   | Oversized files (persist-game 450 lines) | MEDIUM   | Organization  |
| 3   | Small name pool (43 for 240 players)     | LOW      | Data Quality  |
| 4   | Consistent code patterns                 | N/A      | Positive      |
| 5   | Minor naming inconsistencies             | LOW      | Consistency   |
| 6   | Dual data sources for seed names         | LOW      | Maintenance   |
| 7   | 13-link horizontal navigation            | LOW      | UX            |
| 8   | No README documentation                  | MEDIUM   | Documentation |
