> Last touched by agent: 2026-05-07T23:35:00Z
> Purpose: Enforce simulation contract and persistence boundary checks in review.

## Summary

Describe what changed and why.

## Verification

- [ ] Ran relevant tests locally
- [ ] Ran web typecheck (`npx tsc -p apps/web/tsconfig.json --noEmit`)

## Scheduled Sim Contract Checklist

Complete this section when touching simulation, persistence, replay, standings, or stats paths.

- [ ] Scheduled game persistence uses `buildScheduledGameContract(...)`
- [ ] Contract metadata includes `scheduleId`, `leagueId`, `seasonNo`, `seed`, `simVersion`, `configVersion`
- [ ] `assertGameResultContract(...)` invariants remain true for changed paths
- [ ] Replay continues to source outcomes from persisted events (no hidden randomness)

## Transaction Boundary Checklist

Complete this section when touching [apps/web/src/lib/sim/persist-game.ts](apps/web/src/lib/sim/persist-game.ts).

- [ ] Step order is preserved: game row/events -> game stats -> season stats -> standings -> schedule played -> revenue
- [ ] Every DB write/RPC in the boundary has explicit error handling
- [ ] Schedule finalization still guards with `played = false`
- [ ] Retry behavior remains idempotent (no duplicate finalized game writes)
