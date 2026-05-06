> Last touched by agent: 2026-05-06T14:06:08Z
> Purpose: Track /sim-lab-2 webpack compile profiling and benchmark deltas.

# /sim-lab-2 Dev Compile Perf Log

## Repeatable Workflow

```bash
# 1) Profile + stats capture run (module timings + fan-out)
NEXT_WEBPACK_STATS_DIR=.next/perf-stats npm run dev -w apps/web
node apps/web/scripts/benchmark-dev-routes.mjs --baseUrl=http://localhost:3000 --routes=/,/sim-lab-2 --runs=1
node apps/web/scripts/benchmark-dev-routes.mjs --baseUrl=http://localhost:3000 --routes=/,/dashboard,/sim-lab-2 --runs=5
node apps/web/scripts/benchmark-dev-routes.mjs --baseUrl=http://localhost:3000 --routes=/,/dashboard,/sim-lab-2 --runs=5
node apps/web/scripts/analyze-webpack-stats.mjs --dir=apps/web/.next/perf-stats --top=20

# 2) Acceptance run (realistic timings, no profiling overhead)
npm run dev -w apps/web
node apps/web/scripts/benchmark-dev-routes.mjs --baseUrl=http://localhost:3000 --routes=/,/sim-lab-2 --runs=1
node apps/web/scripts/benchmark-dev-routes.mjs --baseUrl=http://localhost:3000 --routes=/,/dashboard,/sim-lab-2 --runs=5
node apps/web/scripts/benchmark-dev-routes.mjs --baseUrl=http://localhost:3000 --routes=/,/dashboard,/sim-lab-2 --runs=5
```

## Run Log (2026-05-06)

### Profiled baseline (pre-prototype)

- Cold pass
  - `/`: 5247.1ms
  - `/sim-lab-2`: 4168.2ms
- Warm pass 1
  - `/sim-lab-2`: min 13.9ms, avg 78.9ms, max 325.9ms
- Warm pass 2
  - `/sim-lab-2`: min 13.5ms, avg 15.6ms, max 18.0ms

### Profiled post-prototype (lazy worker + dynamic fallback sim import)

- Cold pass
  - `/`: 3577.2ms
  - `/sim-lab-2`: 2686.8ms
- Warm pass 1
  - `/sim-lab-2`: min 26.8ms, avg 188.3ms, max 808.7ms
- Warm pass 2
  - `/sim-lab-2`: min 13.4ms, avg 15.0ms, max 18.1ms

### Non-profile acceptance samples (post-prototype)

- Sample A cold pass
  - `/`: 3341.2ms
  - `/sim-lab-2`: 3306.1ms
- Sample A warm pass 2
  - `/sim-lab-2`: min 13.7ms, avg 15.3ms, max 18.0ms
- Sample B cold pass
  - `/`: 2803.9ms
  - `/sim-lab-2`: 2544.2ms

## Stats Findings (module profile + fan-out)

- Client graph fan-out remains dominated by `pixi.js`:
  - `node_modules/pixi.js/lib/index.mjs` fan-out: 626
  - `node_modules/pixi.js/lib/rendering/index.mjs` fan-out: 235
  - `node_modules/pixi.js/lib/scene/index.mjs` fan-out: 196
- Server compile-time hotspots include:
  - `next-middleware-loader` chain for `src/proxy.ts`
  - Node externals/instrumentation modules (`@sentry/*`, `@opentelemetry/*`)
- Post-prototype profiled cold compile dropped materially vs profiled baseline, but unprofiled cold compile still shows high run-to-run variance.

## Acceptance Criteria (P1 Web)

- Use at least 3 fresh cold runs (server restart between runs).
- Cold acceptance:
  - median `/sim-lab-2` cold <= previous median, or at least 10% improvement.
- Warm acceptance:
  - warm pass 2 `/sim-lab-2` avg <= 25ms and max <= 40ms.
- Variance acceptance:
  - warm pass 2 `/sim-lab-2` max should not regress by more than 20% vs previous baseline.
- If criteria are mixed, keep change behind explicit guard/feature flag or revert.
