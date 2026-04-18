# Review: Data Integrity

> **Review Date:** April 18, 2026  
> **Scope:** Database constraints, referential integrity, concurrency, RLS policies  

---

## Summary

The schema is well-designed with 20 tables, appropriate indexes, and RLS enabled everywhere. However, several **missing constraints** could allow invalid data, the **budget system has race conditions** due to non-atomic operations, and the **standings unique key is missing `season_no`** which would break multi-season play.

---

## Findings

### 1. Budget Operations Are Not Atomic (Race Condition)

**Severity:** 🟠 HIGH  
**File:** `src/lib/finance/budget.ts`

**Issue:** The `recordTransaction()` function performs a read-calculate-write sequence across three separate queries with no transaction wrapper:

```typescript
// Step 1: Insert transaction log entry
await supabase.from('financial_transactions').insert({ ... });

// Step 2: Read current balance
const { data: budget } = await supabase
  .from('team_budgets')
  .select('balance')
  .eq('team_id', teamId)
  .single();

// Step 3: Update balance
await supabase
  .from('team_budgets')
  .update({ balance: budget.balance + amount })
  .eq('team_id', teamId);
```

If two operations run concurrently (e.g., two trades or a trade + payroll):
1. Both read balance = $5,000,000
2. Both calculate: $5,000,000 - $500,000 = $4,500,000
3. Both write $4,500,000
4. **Result:** Only one deduction applied instead of two. Team has $4,500,000 instead of $4,000,000.

**Recommendation:** Use a Postgres RPC function with a single atomic UPDATE:
```sql
CREATE OR REPLACE FUNCTION adjust_balance(p_team_id bigint, p_amount bigint)
RETURNS bigint AS $$
  UPDATE team_budgets 
  SET balance = balance + p_amount, updated_at = now()
  WHERE team_id = p_team_id
  RETURNING balance;
$$ LANGUAGE sql;
```

---

### 2. Standings Unique Key Missing season_no

**Severity:** 🟠 HIGH  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** The unique constraint is on `(league_id, team_id)` only:
```sql
create unique index idx_standings_unique on public.standings(league_id, team_id);
```

This prevents having standings for the same team in different seasons. When season 2 starts and tries to insert new standings rows, it will either:
- Fail with a unique constraint violation, OR
- If using upsert, overwrite season 1 data

**Recommendation:** New migration:
```sql
DROP INDEX idx_standings_unique;
CREATE UNIQUE INDEX idx_standings_unique ON public.standings(league_id, team_id, season_no);
```

---

### 3. No CHECK Constraints on Skill Values

**Severity:** 🟡 MEDIUM  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** Player skill columns (`speed`, `stamina`, `ag`, `eye`, `avg`, `strength`, `dhr`, `play_intel`, `bunting`, `fielding`, `throw`) have no CHECK constraints. The DB accepts any integer value.

Similarly, `max_*` columns (potential caps) have no constraint ensuring `max >= current`.

**Missing constraints:**
```sql
-- Skill ranges
CHECK (speed BETWEEN 0 AND 10)
CHECK (stamina BETWEEN 0 AND 10)
-- ... for all 11 skills

-- Max potential >= current skill
CHECK (max_speed >= speed)
CHECK (max_stamina >= stamina)
-- ... for all 11 max_* columns

-- Max potential cap
CHECK (max_speed <= 10)
```

**Impact:** A bug in training, trades, or admin operations could set a skill to 50 or -3. The simulation engine doesn't validate inputs and would produce wildly incorrect probability thresholds.

---

### 4. No CHECK Constraint on Budget Balance

**Severity:** 🟡 MEDIUM  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** `team_budgets.balance` can go negative. There's no constraint:
```sql
-- Missing:
CHECK (balance >= 0)
```

Combined with the race condition in Finding #1, a team could overdraft — spending money they don't have.

**Recommendation:** Add `CHECK (balance >= 0)` and fix the race condition first. The constraint acts as a safety net.

---

### 5. Missing CHECK Constraints on Other Columns

**Severity:** 🟢 LOW  
**File:** `supabase/migrations/001_initial_schema.sql`

Missing constraints on various columns:

| Column | Table | Recommended Constraint |
|--------|-------|----------------------|
| `age` | players | `CHECK (age BETWEEN 18 AND 50)` |
| `salary` | players | `CHECK (salary >= 0)` |
| `contract` | players | `CHECK (contract >= 0)` |
| `jersey_no` | players | `CHECK (jersey_no BETWEEN 0 AND 99)` |
| `height` | players | `CHECK (height BETWEEN 60 AND 84)` |
| `weight` | players | `CHECK (weight BETWEEN 140 AND 320)` |
| `batt_order` | players | `CHECK (batt_order BETWEEN 0 AND 15)` |
| `rotation_slot` | players | `CHECK (rotation_slot BETWEEN 0 AND 9)` |
| `training_slot` | players | `CHECK (training_slot BETWEEN 0 AND 9)` |
| `home_runs`, `visitor_runs` | games | `CHECK (home_runs >= 0)` |
| `wager` | challenge_requests | `CHECK (wager >= 0)` |

---

### 6. No Transaction Wrapping on Multi-Step Persistence

**Severity:** 🟠 HIGH  
**File:** `src/lib/sim/persist-game.ts`

**Issue:** The 9-step game persistence pipeline has no `BEGIN`/`COMMIT` transaction. If step 5 fails (season stats upsert) after steps 1-4 succeeded, the database is left in an inconsistent state:
- A game record exists but season totals aren't updated
- The schedule is not marked as played, so a retry would try to re-persist

**Failure scenario:**
```
Step 1: INSERT game record           ✅ (committed)
Step 2: INSERT game_events           ✅ (committed)
Step 3: INSERT game_stats_hitting    ✅ (committed)
Step 4: INSERT game_stats_pitching   ✅ (committed)
Step 5: UPSERT season hitting stats  ❌ (fails)
Step 6-9: Never executed
```

Now the game exists in `games` table but standings are wrong and the schedule still shows `played=false`. A retry would try to insert a duplicate game.

**Recommendation:** Use a Supabase RPC function that wraps the entire persistence in a single Postgres transaction, or at minimum mark the schedule as played first (idempotency guard) and make stats upserts idempotent with `ON CONFLICT`.

---

### 7. Orphan Records on Team Deletion

**Severity:** 🟡 MEDIUM  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** The `players` table uses `ON DELETE SET NULL` for `team_id`:
```sql
team_id bigint references public.teams(id) on delete set null
```

If a team is deleted:
- Players remain with `team_id = NULL` but are not free agents (roster_status unchanged)
- `player_stats_hitting` and `player_stats_pitching` rows reference the deleted team
- `standings` rows reference the deleted team
- `financial_transactions` reference the deleted team
- `trade_listings` may reference the deleted team

**Impact:** Orphaned data accumulates. Stats pages could show players belonging to a null team.

**Recommendation:** Either:
- Don't allow team deletion (soft delete with `archived_at` timestamp)
- Or cascade: set players to free_agent, archive standings, clean up related records

---

### 8. JSONB Linescore Has No Schema Validation

**Severity:** 🟢 LOW  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** `games.home_linescore` and `games.visitor_linescore` are JSONB columns with no validation. They could store any JSON value — a string, a number, an array with non-numeric elements, etc.

**Current usage:** These store arrays of inning scores: `[0, 1, 0, 2, 0, 0, 1, 0, 0]`

**Recommendation:** Add a CHECK constraint using `jsonb_typeof`:
```sql
CHECK (jsonb_typeof(home_linescore) = 'array')
CHECK (jsonb_typeof(visitor_linescore) = 'array')
```

---

### 9. Trade Offer Player IDs Have No FK Constraint

**Severity:** 🟡 MEDIUM  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** `trade_offers.offered_player_ids` is a `bigint[]` array. Arrays in Postgres cannot have foreign key constraints. A trade offer could reference player IDs that:
- Don't exist
- Belong to a different team
- Have already been traded away

The application code validates ownership at offer time, but there's no database-level protection against data corruption.

**Recommendation:** Acceptable for now — the application validation is the correct layer for this. But consider a `trade_offer_players` junction table for strict referential integrity in a future refactor.

---

### 10. RLS Write Policies Are Incomplete

**Severity:** 🟡 MEDIUM  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** RLS is enabled on all 20 tables (good). Read policies are comprehensive. But write (INSERT/UPDATE) policies are sparse:

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| leagues | ✅ Public | ❌ | ❌ | ❌ |
| teams | ✅ Public | ❌ | ✅ Owner | ❌ |
| players | ✅ Public | ❌ | ✅ Owner | ❌ |
| schedules | ✅ Public | ❌ | ❌ | ❌ |
| standings | ✅ Public | ❌ | ❌ | ❌ |
| games | ✅ Public | ❌ | ❌ | ❌ |
| game_events | ✅ Public | ❌ | ❌ | ❌ |
| team_budgets | ✅ Owner | ❌ | ❌ | ❌ |
| financial_transactions | ✅ Owner | ❌ | ❌ | ❌ |
| trade_listings | ✅ Public | ❌ | ❌ | ❌ |
| trade_offers | ✅ Involved | ✅ From-team | ✅ To-team | ❌ |
| notifications | ✅ Owner | ❌ | ✅ Owner | ❌ |

All writes to games, stats, standings, budgets, and most other tables must go through service-role. This is intentional (system operations) but means the service-role key is a single point of failure for data integrity.

**Recommendation:** This design is acceptable — game results should only be written by the system, not by users. Document this clearly so future developers don't accidentally try to use user-auth Supabase clients for system writes.

---

### 11. No Auto-Creation of team_budgets on Team Insert

**Severity:** 🟢 LOW  
**File:** `supabase/migrations/001_initial_schema.sql`

**Issue:** When a team is created, the provisioning code manually inserts a `team_budgets` row. If team creation succeeds but budget insertion fails, the team exists without a budget. There's no Postgres trigger to auto-create the budget row.

**Recommendation:** Add a trigger:
```sql
CREATE OR REPLACE FUNCTION create_team_budget() RETURNS trigger AS $$
BEGIN
  INSERT INTO team_budgets (team_id, balance) VALUES (NEW.id, 5000000);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_team_budget
  AFTER INSERT ON teams
  FOR EACH ROW EXECUTE FUNCTION create_team_budget();
```

---

## Index Coverage Analysis

### Existing Indexes (Good)

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_teams_league` | `league_id` | Team lookups by league |
| `idx_teams_owner` | `owner_id` | Team lookups by user |
| `idx_players_team` | `team_id` | Roster lookups |
| `idx_players_roster` | `roster_status` | Filter active/reserve/free_agent |
| `idx_schedules_unplayed` | `played` WHERE false | Partial index for unplayed games |
| `idx_schedules_teams` | `home_team_id, visitor_team_id` | Schedule by teams |
| `idx_standings_league` | `league_id, season_no` | Standings queries |
| `idx_game_events_game` | `game_id, seq` | Event playback |
| `idx_notifications_user` | `user_id, read` | Unread notification count |

### Missing Indexes

| Recommended Index | Purpose |
|-------------------|---------|
| `idx_ft_created` on `financial_transactions(created_at)` | Time-range financial queries |
| `idx_tl_player` on `trade_listings(player_id)` | Find listings for a specific player |
| `idx_cr_created` on `challenge_requests(created_at)` | Expiration checks |
| `idx_gsh_team` on `game_stats_hitting(team_id)` | Per-team game stat aggregation |
| `idx_gsp_team` on `game_stats_pitching(team_id)` | Per-team pitching stat aggregation |

---

## Summary Table

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1 | Budget operations not atomic (race condition) | HIGH | Concurrency |
| 2 | Standings unique key missing season_no | HIGH | Constraints |
| 3 | No CHECK constraints on skill values | MEDIUM | Validation |
| 4 | No CHECK constraint on budget balance | MEDIUM | Validation |
| 5 | Missing CHECK constraints on various columns | LOW | Validation |
| 6 | No transaction wrapping on game persistence | HIGH | Consistency |
| 7 | Orphan records on team deletion | MEDIUM | Referential Integrity |
| 8 | JSONB linescore has no schema validation | LOW | Validation |
| 9 | Trade offer player IDs have no FK | MEDIUM | Referential Integrity |
| 10 | RLS write policies incomplete (by design) | MEDIUM | Security |
| 11 | No auto-creation of team_budgets | LOW | Automation |
