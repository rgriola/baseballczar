# Review: Error Handling

> **Review Date:** April 18, 2026  
> **Scope:** Error patterns, failure modes, logging, observability

---

## Summary

The application has a solid validation-first pattern with Zod schemas at API boundaries. However, **no structured logging exists**, **multi-step operations have no transaction wrapping**, and **the game simulation provides zero observability** — errors happen in silence with no way to diagnose issues.

---

## Findings

### 1. No Structured Logging Anywhere

**Severity:** 🟠 HIGH  
**Scope:** Entire codebase

**Issue:** There are no logging calls — no `console.log`, no logging library, no structured output. When the game simulation runs 147 games, there is zero visibility into:

- Which game is currently being simulated
- How long each game takes
- Whether any games failed and why
- Database query errors during persistence
- Training results (which players improved, by how much)
- Trade execution details

In the original Java version, the sim daemon had its own terminal with real-time log output. The current system provides nothing.

**Impact:** When something goes wrong (and it will in production), there is no diagnostic information available. The user sees a generic error or a hung request, and the developer has no way to investigate.

**Recommendation:** Add a structured logger (e.g., `pino`):

```typescript
import pino from "pino";
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

// In sim orchestration:
logger.info({ scheduleId, homeTeam, visitorTeam }, "Starting game simulation");
logger.info({ gameId, homeRuns, visitorRuns, elapsed }, "Game persisted");
logger.error({ scheduleId, error: err.message }, "Game simulation failed");
```

---

### 2. Game Persistence Has No Transaction Safety

**Severity:** 🟠 HIGH  
**File:** `src/lib/sim/persist-game.ts`

**Issue:** The 9-step persistence pipeline runs as 9+ independent database operations. If any step fails, the previous steps are already committed and cannot be rolled back.

**Failure modes and their consequences:**

| Failure Point                 | State Left Behind                                                              |
| ----------------------------- | ------------------------------------------------------------------------------ |
| After step 1 (insert game)    | Ghost game record with no events or stats                                      |
| After step 2 (insert events)  | Game + events, but no player stats credited                                    |
| After step 5 (season hitting) | Game-level stats exist but season totals wrong                                 |
| After step 7 (standings)      | Stats updated but W/L record wrong                                             |
| After step 8 (mark played)    | Everything persisted but schedule still shows unplayed — retry would duplicate |

**Impact:** Data inconsistency that's very difficult to detect and fix manually.

**Recommendation:** Either:

1. Use a Supabase RPC to wrap all steps in a single Postgres transaction
2. Or implement an idempotency guard: mark the schedule as "in-progress" first, make all upserts use `ON CONFLICT`, and mark "played" only at the very end

---

### 3. Sim-All Continues on Failure (Good) But No Reporting

**Severity:** 🟡 MEDIUM  
**File:** `src/app/api/sim/sim-all/route.ts`

**Issue:** The `sim-all` endpoint correctly continues processing when individual games fail:

```typescript
try {
  const result = await simulateScheduledGame(supabase, game.id);
  results.push(result);
  simulated++;
} catch {
  failed++;
}
```

But:

- The caught error is discarded — no details about what failed or why
- The response includes `failed: N` count but not which games failed
- There's no retry mechanism for failed games

**Recommendation:** Capture failed game IDs and error messages:

```typescript
catch (err) {
  failed++;
  failures.push({
    scheduleId: game.id,
    error: err instanceof Error ? err.message : 'Unknown'
  });
}
// Include in response: { simulated, failed, failures }
```

---

### 4. Information Disclosure in Error Responses

**Severity:** 🟡 MEDIUM  
**Files:** Multiple API routes

**Issue:** Several routes expose internal details in error messages:

```typescript
// Budget amount leaked
{
  error: `Insufficient funds. Need $${cost}, have $${budget.balance}`;
}

// Database error message forwarded (could contain schema info)
{
  error: error.message;
}

// Roster counts exposed
{
  error: `Active roster full (${count} players)`;
}
```

**Impact:** An attacker can enumerate budget balances, roster sizes, and database schema details through error messages.

**Recommendation:** Use generic user-facing messages and log the details server-side:

```typescript
logger.warn({ teamId, cost, balance }, "Insufficient funds");
return NextResponse.json({ error: "Insufficient funds" }, { status: 400 });
```

---

### 5. Provisioning Has No Error Recovery

**Severity:** 🟡 MEDIUM  
**File:** `src/lib/provisioning/provision-team.ts`

**Issue:** When the 6th team joins and triggers league fill (AI teams + schedule generation), this involves ~200+ database inserts. If it fails midway:

- Some AI teams may exist without players
- Some AI teams may have players but no standings or budget
- The schedule may be partially generated
- The league status may or may not have been set to "full"

There's no cleanup logic, no transaction wrapping, and no way to detect or recover from a partial provisioning.

**Recommendation:** Track provisioning state (e.g., `league.provisioning_status = 'in_progress'`) and implement a recovery function that can clean up and retry.

---

### 6. Training Engine Silently Skips Players

**Severity:** 🟢 LOW  
**File:** `src/lib/training/run.ts`

**Issue:** The daily training function skips players who are age 30+ or already at their max skill, but these skips are completely silent. There's no count of how many players trained, how many skipped, or how many improved.

**Impact:** When debugging training issues, there's no way to know if training ran correctly without querying the database directly.

**Recommendation:** Return a summary object:

```typescript
return {
  processed: 120,
  improved: 45,
  atMax: 30,
  over30: 40,
  skipped: 5,
};
```

---

### 7. Client-Side Error Display is Minimal

**Severity:** 🟢 LOW  
**Files:** Various client components (roster-toggle, sim-controls, etc.)

**Issue:** Client components generally handle errors by:

- Setting an error state string
- Displaying it briefly (or not at all)
- No toast/notification system for transient errors

For example, `sim-controls.tsx` shows errors as red text below the button, but `roster-toggle.tsx` silently swallows errors (the result is checked but no error UI is shown).

**Recommendation:** Implement a simple toast notification system for client-side errors, or at minimum ensure all action components display error messages.

---

### 8. No Health Check Endpoint

**Severity:** 🟢 LOW  
**Scope:** API routes

**Issue:** There's no `/api/health` endpoint that monitoring tools could use to verify the application is running and can connect to the database.

**Recommendation:**

```typescript
// src/app/api/health/route.ts
export async function GET() {
  const supabase = createServiceClient();
  const { error } = await supabase.from("leagues").select("id").limit(1);
  if (error) return NextResponse.json({ status: "error" }, { status: 503 });
  return NextResponse.json({ status: "ok" });
}
```

---

## Error Handling Patterns Inventory

### Good Patterns (Keep These)

| Pattern                | Where Used         | Example                                        |
| ---------------------- | ------------------ | ---------------------------------------------- |
| Zod validation first   | All API routes     | `schema.safeParse()` → 400                     |
| Ownership verification | User-facing routes | `requireMyTeam()` → verify team_id             |
| HTTP status codes      | All routes         | 400, 401, 403, 404, 409, 500 used correctly    |
| Defensive DB filters   | Market signing     | `.eq('roster_status', 'free_agent')` in update |
| Try/catch on mutations | Trade execution    | Wraps `executeTrade()` with error handling     |

### Patterns to Fix

| Pattern                      | Problem          | Fix                                   |
| ---------------------------- | ---------------- | ------------------------------------- |
| Bare `catch {}` in sim-all   | Errors discarded | Capture and report                    |
| `error.message` in responses | Info disclosure  | Generic messages + server logging     |
| No transaction wrapping      | Partial failures | DB transactions or idempotent upserts |
| Silent operations            | No observability | Structured logging                    |

---

## Summary Table

| #   | Finding                                    | Severity | Category         |
| --- | ------------------------------------------ | -------- | ---------------- |
| 1   | No structured logging anywhere             | HIGH     | Observability    |
| 2   | Game persistence has no transaction safety | HIGH     | Data Consistency |
| 3   | Sim-all discards failure details           | MEDIUM   | Error Reporting  |
| 4   | Information disclosure in error messages   | MEDIUM   | Security         |
| 5   | Provisioning has no error recovery         | MEDIUM   | Reliability      |
| 6   | Training silently skips players            | LOW      | Observability    |
| 7   | Client-side error display minimal          | LOW      | UX               |
| 8   | No health check endpoint                   | LOW      | Operations       |
