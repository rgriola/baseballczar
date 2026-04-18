# Review: Architecture & Design

> **Review Date:** April 18, 2026  
> **Scope:** Overall architecture, component design, game simulation system, daemon equivalents  

---

## Summary

The application follows clean Next.js App Router conventions with a well-separated game engine. The biggest architectural gap is that **all heavy processing (game sim, training, payroll) runs inside the web server process** instead of as background workers — this is the root cause of the "slow and silent" experience compared to the original Java daemon architecture.

---

## Overall Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Dashboard │  │  Auth    │  │  Client Components   │  │
│  │  Pages    │  │  Pages   │  │  (LineupEditor, etc) │  │
│  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘  │
└───────┼──────────────┼───────────────────┼──────────────┘
        │              │                   │
        │    Server Actions (form submits) │
        │              │                   │
┌───────┼──────────────┼───────────────────┼──────────────┐
│       ▼              ▼                   ▼              │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Next.js Server (App Router)            │   │
│  │                                                   │   │
│  │  /app/dashboard/*   → Server Components (RSC)    │   │
│  │  /app/api/*         → API Route Handlers          │   │
│  │  /app/(auth)/*      → Auth pages + actions        │   │
│  │  middleware.ts       → Session refresh + guards    │   │
│  └───────────────────────┬───────────────────────────┘   │
│                          │                               │
│  ┌───────────────────────┼───────────────────────────┐   │
│  │              /lib/ (Business Logic)                │   │
│  │                       │                            │   │
│  │  sim-engine/  ← Pure game engine (no DB)          │   │
│  │  sim/         ← Orchestration (load → sim → save) │   │
│  │  trades/      ← Trade execution + valuation       │   │
│  │  training/    ← Daily skill improvement           │   │
│  │  finance/     ← Budget operations                 │   │
│  │  notifications/ ← In-app alerts                   │   │
│  │  provisioning/  ← Team creation + AI fill         │   │
│  └───────────────────────┬───────────────────────────┘   │
│                          │                               │
│                     Supabase Client                      │
└──────────────────────────┼───────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Supabase   │
                    │ (Postgres)  │
                    │  + Auth     │
                    │  + RLS      │
                    └─────────────┘
```

### What Works Well

1. **Clean separation of concerns** — The `sim-engine/` directory contains pure TypeScript with zero database dependencies. It can be tested, profiled, and potentially run in a worker thread without any refactoring.

2. **Server Components by default** — Dashboard pages are server-rendered with client components only where interactivity is needed (lineup editor, rotation editor, roster toggle). This minimizes client JavaScript.

3. **Supabase client factories** — Three distinct client types (browser, server, service-role) with clear usage boundaries.

4. **Zod validation at API boundaries** — Every API route validates input with Zod schemas before touching the database.

5. **RLS on all tables** — Row-Level Security is enabled everywhere, with service-role used only for system operations.

---

## Findings

### 1. Game Simulation Runs In-Process (No Worker)

**Severity:** 🟠 HIGH  
**Files:** `src/app/api/sim/sim-all/route.ts`, `src/app/api/sim/run-due/route.ts`

**Issue:** The original Baseball Czar ran game simulation as a **separate Java process** — it had its own terminal, visible log output, and didn't block the website. The current v2 runs simulation inside a Next.js API route handler, which means:

- **Blocks the web server** — During a full season sim, the Node.js event loop is occupied processing games. Other requests may be delayed.
- **No visibility** — No logs, no progress updates, no terminal output. The user clicks "Simulate" and waits in silence.
- **Timeout risk** — Vercel and similar platforms impose 5-minute API timeouts. A 147-game season at ~1.5s/game = 220+ seconds.
- **No retry/resume** — If the process crashes mid-season, there's no checkpoint. You have to restart from where it left off manually.

**The Infrastructure is Already Here:**
```json
// package.json
"bullmq": "^5.74.1",
"ioredis": "^5.10.1"
```

BullMQ (a Redis-backed job queue) and ioredis are installed but not connected.

**Recommended Architecture:**

```
┌─────────────┐     POST /api/sim/enqueue      ┌──────────────┐
│  Dashboard   │ ──────────────────────────────▶│  Next.js API  │
│  (Browser)   │                                │  (Enqueue Job)│
└──────┬──────┘                                └───────┬──────┘
       │                                               │
       │  SSE or polling for progress                  │ Redis queue
       │                                               ▼
       │                                      ┌──────────────┐
       │◀─────── progress updates ────────────│  BullMQ       │
       │                                      │  Worker       │
       │                                      │  (separate    │
       │                                      │   process)    │
       │                                      │              │
       │                                      │  ✓ Own logs  │
       │                                      │  ✓ Progress  │
       │                                      │  ✓ Retry     │
       │                                      │  ✓ No timeout│
       │                                      └──────────────┘
```

---

### 2. No Daemon Equivalents for Training & Trades

**Severity:** 🟠 HIGH  
**Files:** `src/app/api/training/run/route.ts`, `src/app/api/payroll/run/route.ts`

**Issue:** In the original system:
- **Training daemon** ran once every 24 hours, processing all players across all leagues
- **Trade window daemon** watched for trade deadline expiration and auto-expired pending offers
- **Payroll daemon** ran weekly to deduct salaries

In v2, these are manual API calls protected by Bearer token. There is no cron scheduler, no BullMQ repeatable job, and no automated trigger.

**Impact:**
- Training never runs unless manually triggered
- Trades never expire (challenge_requests have `'expired'` status but nothing sets it)
- Payroll never deducts unless called manually

**Recommendation:** Wire up BullMQ repeatable jobs:
```typescript
// Scheduled jobs
simQueue.add('daily-training', {}, { repeat: { pattern: '0 4 * * *' } });      // 4 AM daily
simQueue.add('weekly-payroll', {}, { repeat: { pattern: '0 5 * * 1' } });      // Monday 5 AM
simQueue.add('expire-challenges', {}, { repeat: { pattern: '0 * * * *' } });   // Hourly
simQueue.add('sim-due-games', {}, { repeat: { pattern: '*/5 * * * *' } });     // Every 5 min
```

---

### 3. Repeated Auth Boilerplate in API Routes

**Severity:** 🟡 MEDIUM  
**Scope:** All 14 authenticated API routes

**Issue:** Every authenticated API route repeats the same 10-line auth block:

```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

const { data: team } = await supabase
  .from('teams')
  .select('id')
  .eq('owner_id', user.id)
  .single();
if (!team) return NextResponse.json({ error: 'No team found' }, { status: 404 });
```

And Bearer-token routes repeat:
```typescript
const authHeader = request.headers.get('authorization');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Impact:** Code duplication increases the risk of inconsistency (e.g., the sim routes forgot to add auth).

**Recommendation:** Create shared middleware helpers:
```typescript
// lib/api/auth.ts
export async function requireUser(request: Request) { ... }
export async function requireTeamOwner(request: Request) { ... }
export async function requireServiceKey(request: Request) { ... }
```

---

### 4. Provisioning Auto-Fill Creates Full League on 6th Team

**Severity:** 🟡 MEDIUM  
**File:** `src/lib/provisioning/provision-team.ts`

**Issue:** When the 6th team joins a league, the system auto-fills remaining slots with AI teams, generates 40 players per AI team, creates standings, budgets, and generates the full 150-game schedule. This is a massive operation (~200+ database inserts) triggered by a single user action (team creation).

**Impact:**
- The provisioning request takes 10-30 seconds to complete
- If it fails mid-way, the league is in a partially-created state
- No transaction wrapping — partial AI teams or schedules could exist

**Recommendation:**
- Move league-fill and schedule generation to a BullMQ job
- Return immediately to the user with "League is being set up..."
- Notify via in-app notification when ready

---

### 5. No API Versioning

**Severity:** 🟢 LOW  
**Scope:** All API routes

**Issue:** All routes are at `/api/...` with no version prefix. If the API contract changes (e.g., different request/response format), existing clients break.

**Recommendation:** Not urgent for a single-frontend app, but worth considering `/api/v1/...` if the API will be consumed by external tools or a future mobile app.

---

## Game Simulation Deep Dive

### Engine Architecture (9 Files)

```
sim-engine/
├── types.ts           ← All interfaces (PlayerSkills, GameResult, GameStats, AtBatOutcome enum)
├── GameEngine.ts      ← Main simulation loop
│   └── simulateGame(visitor, home) → GameResult
│       ├── Inning loop (do/while until win condition)
│       ├── Top half: visitor bats, home pitches
│       ├── Bottom half: home bats, visitor pitches
│       ├── Walk-off detection (9th+ inning)
│       └── Win/loss finalization
├── AtBat.ts           ← Single at-bat resolution
│   └── resolveAtBat(hitterThresholds, pitcherThresholds) → outcome + roll
├── PlayerSkills.ts    ← Skill-to-probability conversion
│   ├── calculateHitterSkill(skills) → cumulative thresholds [S, D, T, HR, BB, K, GO]
│   ├── calculatePitcherSkill(skills, bf) → same thresholds, with stamina decay
│   └── applyStaminaDecay(skills, battersFaced) → degraded skills
├── Field.ts           ← Baserunning state machine
│   ├── runners[0-6]: batter, 1B, 2B, 3B, scoring slots
│   ├── baseSequence(outcome) → play descriptions
│   └── Runner advancement rules per outcome type
├── StatsAccumulator.ts ← Helper functions
│   ├── addHitterPA(), addPitcherPA(), addTeamHittingStats()
│   ├── createGameStats(), createPitcherBoxLine()
│   └── creditRuns(), addPitcherER(), addHitterRun()
├── ScoreBoard.ts      ← Inning-by-inning tracking (max 35 innings)
├── GateReceipts.ts    ← Revenue constants
│   ├── Regular: home $22,500, visitor $15,000
│   ├── Playoff: home $35,000, visitor $25,000
│   └── Food/bev 15%, ads 8%, stadium ops -$5,000
└── index.ts           ← Public exports
```

### Data Flow: One Game

```
1. Load Schedule    SELECT * FROM schedules WHERE id=X AND played=false
        │
2. Load Teams      SELECT id, team_name FROM teams WHERE id IN (home, visitor)
        │
3. Load Rosters    SELECT hitters (9, active, ordered by batt_order)
   (4 queries)     SELECT pitchers (active, rotation_slot > 0, ordered)
                   × 2 teams
        │
4. Simulate        simulateGame(visitor, home)  ← Pure TypeScript, ~5ms
        │           Returns: GameResult with:
        │           - Final score, innings, winner/loser
        │           - events[] (300+ play-by-play entries)
        │           - homePlayerStats / visitorPlayerStats (Map<id, GameStats>)
        │           - homePitcherStats / visitorPitcherStats (Map<id, PitcherBoxLine>)
        │
5. Persist         9-step pipeline (see Performance review for details):
   (~1.5 sec)      game → events → hitting stats → pitching stats →
                   season hitting → season pitching → standings →
                   mark played → revenue
```

### Key Design Decisions in the Engine

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Pure TypeScript, no DB | Engine can be unit-tested without database | Requires separate orchestration layer |
| Single random roll per at-bat | Simple, fast | Less realistic than pitch-by-pitch sim |
| Dominance-based threshold | Prevents "average of averages" problem | Creates cliff-effects (see Correctness review) |
| Pitcher fatigue by BF count | Simple tracking, no pitch count | Less granular than real baseball |
| Fixed bullpen order by rotation_slot | Predictable | No in-game strategy adjustments |
| Baserunning as state machine | Clear rules, deterministic per outcome | Simplified (no stolen bases during at-bats) |

### What the Original Java System Did Differently

| Feature | Java v1 | TypeScript v2 |
|---------|---------|---------------|
| Process model | Separate JVM process | In-process API route |
| Logging | Own terminal with real-time output | None (silent) |
| Progress | Visible game-by-game in console | None |
| Error recovery | Daemon restarts, picks up where left off | No checkpoint, manual restart |
| Training | 24-hour cron daemon | Manual API call |
| Trades | Trade-window daemon with deadline logic | Manual API call, no expiration |
| Payroll | Scheduled weekly daemon | Manual API call |
| Season sim speed | ~2 minutes for 150 games | ~3-4 minutes (timeout risk) |
| Connection model | Persistent JDBC connection pool | Per-request Supabase client |

---

## Summary Table

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1 | Game sim runs in-process, no worker | HIGH | Process Model |
| 2 | No daemon equivalents (training, trades, payroll) | HIGH | Automation |
| 3 | Repeated auth boilerplate across API routes | MEDIUM | Code Organization |
| 4 | Provisioning does massive work synchronously | MEDIUM | User Experience |
| 5 | No API versioning | LOW | API Design |
