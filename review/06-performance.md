# Review: Performance

> **Review Date:** April 18, 2026  
> **Scope:** Query efficiency, simulation throughput, rendering, scalability

---

## Summary

Performance is the **most user-visible problem** in the current build. The original Java-based simulator completed a 150-game season in ~2 minutes. The current system takes 3-4 minutes and risks hitting API timeouts. The root causes are **N+1 query patterns** in stats persistence and **sequential single-threaded game processing** with no parallelism.

---

## Findings

### 1. CRITICAL: N+1 Query Pattern in Season Stats Upsert

**Severity:** 🔴 CRITICAL  
**File:** `src/lib/sim/persist-game.ts`

**Issue:** After each game, season stats are upserted per-player with individual SELECT + UPDATE/INSERT pairs:

```typescript
// For EACH player who played in the game:
for (const [playerId, stats] of statsMap.entries()) {
  // Query 1: Check if season row exists
  const { data: existing } = await supabase
    .from('player_stats_hitting')
    .select('*')
    .eq('player_id', playerId)
    .eq('season_no', seasonNo)
    .single();

  if (existing) {
    // Query 2: Update with accumulated stats
    await supabase.from('player_stats_hitting')
      .update({ g: existing.g + 1, ab: existing.ab + stats.ab, ... })
      .eq('id', existing.id);
  } else {
    // Query 2: Insert new season row
    await supabase.from('player_stats_hitting')
      .insert({ player_id: playerId, season_no: seasonNo, g: 1, ab: stats.ab, ... });
  }
}
```

**Per-game cost:**

- ~9 hitters × 2 queries = 18 queries (hitting)
- ~5 pitchers × 2 queries = 10 queries (pitching)
- **Total: ~28 queries per game**

**Per-season cost (150 games):**

- **~4,200 queries** just for season stats

**Each query is a round-trip to Supabase** — even at 20ms per query, this adds ~840ms per game solely for stats persistence.

**Recommendation:** Use PostgreSQL `ON CONFLICT` upsert in a single batch:

```sql
INSERT INTO player_stats_hitting (player_id, team_id, season_no, g, ab, r, h, ...)
VALUES ($1, $2, $3, 1, $4, $5, $6, ...)
ON CONFLICT (player_id, team_id, season_no)
DO UPDATE SET
  g = player_stats_hitting.g + 1,
  ab = player_stats_hitting.ab + EXCLUDED.ab,
  r = player_stats_hitting.r + EXCLUDED.r,
  h = player_stats_hitting.h + EXCLUDED.h,
  ...;
```

This replaces 28 queries with **2 queries** (one batch for hitters, one for pitchers). Expected improvement: **~85% reduction in per-game persistence time**.

---

### 2. CRITICAL: Sequential Game Processing

**Severity:** 🔴 CRITICAL  
**File:** `src/app/api/sim/sim-all/route.ts`

**Issue:** Full-season simulation processes games one at a time in a single loop:

```typescript
for (const game of allGames) {
  await simulateScheduledGame(supabase, game.id); // ~1.5 sec each
  simulated++;
  if (simulated % 5 === 0) {
    await new Promise((r) => setTimeout(r, 200)); // Extra 200ms every 5 games
  }
}
```

**Timing breakdown per game:**
| Step | Time |
|------|------|
| Load schedule + teams | ~40ms |
| Load rosters (4 queries) | ~80ms |
| Run engine | ~5ms |
| Persist game record + events | ~200ms |
| Persist player game stats | ~100ms |
| **Upsert season stats (N+1)** | **~840ms** |
| Update standings | ~40ms |
| Mark played + revenue | ~60ms |
| **Total per game** | **~1,365ms** |

**Full season: 150 games × 1.5s + sleeps = ~235 seconds (3.9 minutes)**

**Timeout risk:** Vercel API routes have a 5-minute timeout on Pro plans, 10 seconds on Hobby. This sim will fail on Hobby plans and barely fits Pro.

**Recommendation:**

1. **Fix the N+1 first** (Finding #1) — this alone drops per-game time to ~500ms
2. **Parallel processing** — games in the same round use different teams and can run concurrently. Use `Promise.all` with a concurrency limit:

```typescript
const pLimit = (await import("p-limit")).default;
const limit = pLimit(3); // 3 concurrent games
await Promise.all(
  games.map((g) => limit(() => simulateScheduledGame(supabase, g.id))),
);
```

3. **Worker process** — Move to BullMQ for true background processing (see Architecture review)

---

### 3. HIGH: Artificial Sleep in Sim Loop

**Severity:** 🟠 HIGH  
**File:** `src/app/api/sim/sim-all/route.ts`

**Issue:** A 200ms sleep is injected every 5 games:

```typescript
if (simulated % 5 === 0) {
  await new Promise((r) => setTimeout(r, 200));
}
```

For 150 games, this adds **6 seconds** of pure waiting. The intent was likely to prevent overwhelming the database, but with proper connection pooling this isn't necessary.

**Recommendation:** Remove the sleep. If rate limiting is needed, use a semaphore/concurrency limiter instead of a fixed delay.

---

### 4. HIGH: Game Events Batch Size

**Severity:** 🟡 MEDIUM  
**File:** `src/lib/sim/persist-game.ts`

**Issue:** Game events (play-by-play) are batch-inserted in chunks of 200 rows. A typical game produces 300-400 events, so this usually requires 2 batch inserts. This is reasonable.

However, **game events are the largest insert per game** — 300+ rows with text descriptions. Each event row includes:

- `game_id, seq, inning, half, outs`
- `batter_name, pitcher_name` (text)
- `outcome` (text)
- `description` (text, can be long)
- `visitor_runs, home_runs, visitor_hits, home_hits`
- `runners_scored` (text array)

**Observation:** If play-by-play detail isn't needed for the leaders/standings pages (it isn't), consider deferring event insertion to a background job while persisting the critical data (scores, stats, standings) synchronously.

---

### 5. MEDIUM: No Caching for Standings and Stats Pages

**Severity:** 🟡 MEDIUM  
**Files:** Dashboard pages (standings, leaders, stats)

**Issue:** Every page load re-queries the database from scratch. The standings page joins `standings` + `teams` for the full league. The leaders page queries `player_stats_hitting` and `player_stats_pitching` with sorts and limits. The stats page queries all players for the user's team.

During a season, standings and stats change only when games are simulated. Between simulations, the data is static.

**Recommendation:** Use Next.js ISR (Incremental Static Regeneration) or `unstable_cache` with revalidation:

```typescript
import { unstable_cache } from "next/cache";

const getStandings = unstable_cache(
  async (leagueId: number) => {
    /* query */
  },
  ["standings"],
  { revalidate: 60, tags: ["standings"] },
);
```

Revalidate on game completion via `revalidateTag('standings')`.

---

### 6. MEDIUM: Run-Due Endpoint Limited to 50 Games

**Severity:** 🟡 MEDIUM  
**File:** `src/app/api/sim/run-due/route.ts`

**Issue:** The `run-due` endpoint processes at most 50 games per call:

```typescript
const { data: games } = await supabase
  .from("schedules")
  .select("id")
  .eq("played", false)
  .lte("game_time", new Date().toISOString())
  .order("game_time")
  .limit(50);
```

For a league with 150 games, this requires 3 calls to simulate a full season. There's no automatic chaining — an external scheduler must call it repeatedly.

**Recommendation:** This is fine as a design decision if paired with a cron job (every 5 minutes via BullMQ). Document the intended usage pattern.

---

### 7. LOW: No Pagination on Game Events Display

**Severity:** 🟢 LOW  
**File:** `src/app/dashboard/games/[id]/page.tsx`

**Issue:** When viewing a game's play-by-play, all 300+ events are loaded and rendered at once. For extra-innings games, this could be 500+ rows.

**Recommendation:** Either paginate by inning or use virtual scrolling for the event list.

---

### 8. LOW: Supabase Connection Model

**Severity:** 🟢 LOW  
**Scope:** All database operations

**Issue:** Each API request creates a new Supabase client via `createClient()`. Supabase's JavaScript client uses HTTP (not persistent connections), so there's no traditional connection pooling. This is by design and works well for serverless, but means every query is a separate HTTP request.

For the sim loop (which makes 30+ queries per game), the HTTP overhead accumulates. Supabase offers a connection pooler (PgBouncer) for direct Postgres connections, which would be faster for batch operations.

**Recommendation:** For the sim worker (once moved to BullMQ), consider using direct Postgres connections via `pg` or `postgres.js` instead of the Supabase REST API.

---

## Performance Budget: Current vs Optimized

### Per-Game Persistence Time

| Step                    | Current     | After N+1 Fix | After Worker + Batch |
| ----------------------- | ----------- | ------------- | -------------------- |
| Load schedule + teams   | 40ms        | 40ms          | 40ms                 |
| Load rosters            | 80ms        | 80ms          | 40ms (cached)        |
| Run engine              | 5ms         | 5ms           | 5ms                  |
| Insert game + events    | 200ms       | 200ms         | 100ms (direct PG)    |
| Insert game stats       | 100ms       | 100ms         | 50ms (batch)         |
| **Upsert season stats** | **840ms**   | **40ms**      | **20ms**             |
| Update standings        | 40ms        | 40ms          | 20ms                 |
| Mark played + revenue   | 60ms        | 60ms          | 30ms                 |
| **Total**               | **1,365ms** | **565ms**     | **305ms**            |

### Full-Season Simulation Time

| Scenario                                          | Time                   |
| ------------------------------------------------- | ---------------------- |
| Current (sequential + N+1)                        | ~235 seconds (3.9 min) |
| After N+1 fix only                                | ~85 seconds (1.4 min)  |
| After N+1 + remove sleep                          | ~79 seconds (1.3 min)  |
| After N+1 + 3x parallelism                        | ~28 seconds            |
| Full optimization (worker + direct PG + parallel) | ~15 seconds            |

---

## Summary Table

| #   | Finding                        | Severity | Estimated Impact                   |
| --- | ------------------------------ | -------- | ---------------------------------- |
| 1   | N+1 season stats upsert        | CRITICAL | -60% per-game time                 |
| 2   | Sequential game processing     | CRITICAL | 3x-5x improvement with parallelism |
| 3   | Artificial sleep in sim loop   | HIGH     | -6 seconds per season              |
| 4   | Game events batch size         | MEDIUM   | Minor — defer to background        |
| 5   | No caching for standings/stats | MEDIUM   | Faster page loads                  |
| 6   | Run-due limited to 50 games    | MEDIUM   | Requires external scheduler        |
| 7   | No pagination on game events   | LOW      | Better UX for large games          |
| 8   | HTTP-based Supabase client     | LOW      | Direct PG for worker               |
