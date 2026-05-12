> Last touched by agent: 2026-05-06T17:28:17Z

# Issues Log (Sim + Web)


- lineup defense is not aligned correctly. Players can be placed into the lineup not not resolve into the defensive positios. 
- need a web worker to make sure each team has a full lineup, defense and pitching staff before the game, this should run prior to the sim but bot be part of the sim. 



## Resolved During Queue-First Sim Rollout

- `POST /api/sim/sim-all` returned `500` in queue mode when BullMQ received `jobId` values with `:`.
- Worker startup failed with `ECONNREFUSED` when Redis URL was not present in standalone process env.
- Confusion between Upstash REST variables and BullMQ transport requirements caused connection misconfiguration.
- Long single-request full-league simulations were fragile and prone to timeout behavior.

## Resolutions Applied

- Standardized job IDs to `schedule-<id>` for all queue producers (sim-all and daily cron).
- Added worker bootstrap env hydration + Redis ping preflight + actionable error messaging.
- Documented that BullMQ requires TCP Redis (`REDIS_URL` or `BULLMQ_REDIS_URL`), not REST-only Upstash vars.
- Shifted league replay workflow to queue-first batched enqueue with status polling.

## Follow-Up Guardrails

- Any new queue producer should avoid colon characters in custom BullMQ job IDs.
- Keep worker running separately for queue mode (`npm run sim:worker`) before large sim runs.
- Prefer queue mode for 150-game league replay workflows; use inline only for small/local batches.
