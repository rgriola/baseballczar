# Baseball Czar — iOS-First Strategy

## Vision

Move the primary client to **iOS (React Native + Expo)** while keeping the backend (Vercel / Supabase) and sim engine shared. The web app becomes a secondary surface (dashboard, admin, spectator) rather than the primary product.

---

## Why iOS First

- Fantasy/sports gaming is a **mobile-first category** — users manage lineups on the go
- Apple App Store provides distribution, billing (IAP), and push notifications natively
- React Native + Expo EAS lets a solo dev ship to iOS (and Android later) without a full native team
- The sim engine is already iOS-ready (pure TypeScript, no DOM, no Node-only APIs)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Backend  (Vercel + Supabase — unchanged)           │
│  - sim-lab engine runs each scheduled game          │
│  - persists event log (JSONB) + box score           │
│  - REST / tRPC API for lineup, trades, standings    │
└──────────────┬──────────────────────────────────────┘
               │  events.json + box score
               ▼
┌─────────────────────────────────────────────────────┐
│  iOS App  (React Native + Expo)          ← PRIMARY  │
│  - Skia renderer for 2D game playback               │
│  - Lineup management, draft, trades                 │
│  - Push notifications for game results              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Web App  (Next.js — existing)        ← SECONDARY   │
│  - League commissioner tools                        │
│  - Standings / stats browser                        │
│  - PixiJS game viewer (same event log)              │
└─────────────────────────────────────────────────────┘
```

The **sim engine** (`src/lib/sim-lab/`) is a shared TypeScript package used by both surfaces. Zero changes needed for iOS — it is pure math with no runtime dependencies.

---

## Sim Engine Portability

The architectural choices already made are exactly what iOS requires:

| Sim-lab choice              | Why it helps iOS                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Pure functions + seeded RNG | Reproducible across platforms — same seed → same game on any device                       |
| No DOM, no Node imports     | Drops directly into React Native or Swift `JavaScriptCore`                                |
| Single `CONFIG` object      | Calibration ships as one JSON file, shared between web + iOS                              |
| Event log (Phase 8.5)       | Server sims once → ships `events.json` → iOS renders. No expensive on-device sim required |
| 9-skill scale               | Tiny payload — a full team roster is ~5 KB JSON                                           |

---

## iOS Tech Stack

| Layer                | Choice                                       | Rationale                                                               |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Framework            | **React Native + Expo**                      | Shared TypeScript with web; fastest path to App Store                   |
| Build / Distribution | **Expo EAS Build**                           | No Mac CI needed; OTA updates; handles codesigning                      |
| 2D renderer          | **react-native-skia** (Shopify)              | GPU-accelerated canvas for iOS; same API surface as PixiJS conceptually |
| Navigation           | **Expo Router**                              | File-based routing, mirrors Next.js mental model                        |
| State                | **Zustand** (already in web app)             | Drop-in, no changes                                                     |
| API                  | **tRPC / REST** from existing Vercel backend | No new API layer needed                                                 |
| Auth                 | **Supabase Auth** (already wired)            | Works in React Native via `@supabase/supabase-js`                       |
| Push notifications   | **Expo Notifications**                       | Game-result alerts, trade alerts                                        |

---

## Phase Plan (iOS-First)

### Phase A — Shared sim package _(~1 day)_

- Extract `src/lib/sim-lab/` into a local workspace package (`packages/sim-engine`)
- Both the Next.js app and the future React Native app import from `packages/sim-engine`
- Zero logic changes; just a `package.json` boundary

### Phase B — Expo app scaffold _(~1 day)_

- `npx create-expo-app apps/ios --template blank-typescript`
- Wire Supabase auth, tRPC client, Zustand store
- Confirm login → league data → roster screens work end-to-end

### Phase C — Core screens _(~1 week)_

- **Home / Dashboard** — today's games, league standings, notifications
- **Lineup card** — set daily lineup, view player skills
- **Box score** — post-game results, stat line
- **Standings / Schedule** — full league table
- No 2D yet — text-first, get the product loop working

### Phase D — 2D Skia game viewer _(~2 weeks)_

- Port the PixiJS renderer plan (Phase 9) to `react-native-skia`
- Consume the same `SimEvent[]` stream from Phase 8.5
- Milestones:
  - D1: Static field (diamond, OF wall, foul lines)
  - D2: Ball trajectory from `contact` events
  - D3: Fielder convergence + throw animations
  - D4: Runner sprites + scoreboard overlay
  - D5: Playback controls (play / pause / 2× / scrub)

### Phase E — Polish + App Store _(~1 week)_

- Haptics on key moments (HR, strikeout)
- Dark mode (Expo's `useColorScheme`)
- App Store assets, privacy manifest, TestFlight beta
- Submit

---

## Relationship to Existing Web Phases

| Web phase                  | iOS equivalent          | Notes                                            |
| -------------------------- | ----------------------- | ------------------------------------------------ |
| Phase 8.5 — Event log      | ✅ Done                 | Events drive both renderers                      |
| Phase 9 — PixiJS 2D        | Phase D — Skia 2D       | Build web first as reference renderer, then port |
| Phase 8 — Prod integration | Phase B/C — iOS screens | API is shared; iOS consumes same endpoints       |
| Phase 10 — Season loop     | Phase C dashboard       | iOS displays season; backend drives it           |

> **Recommendation:** Complete web Phase 9 (PixiJS) first to validate the visual model, then port the renderer to Skia. A working 2D reference is worth more than starting blind in Skia.

---

## File / Folder Plan

```
baseballczar-v2/
  packages/
    sim-engine/           ← extracted from src/lib/sim-lab
      package.json
      src/
        index.ts
        config.ts
        game.ts
        events.ts
        ...
  apps/
    web/                  ← current Next.js app (moved here)
    ios/                  ← new Expo app
      app/
        (auth)/
        (tabs)/
          index.tsx       ← Dashboard
          lineup.tsx
          standings.tsx
          game/[id].tsx   ← 2D viewer
      components/
        SkiaField.tsx     ← Phase D renderer
        ScoreBoard.tsx
        LineupCard.tsx
```

---

## Key Decisions

**Q: Run sim on-device or server-only?**
Server-only for league games (authoritative). On-device sim is available for exhibition / "what-if" scenarios — the engine is small enough (~50 KB minified) to bundle.

**Q: Android?**
React Native targets both. Once iOS ships, Android is the same codebase — just add `eas build --platform android`. Estimate 1–2 days of Android-specific work.

**Q: Offline support?**
Expo + React Query can cache box scores, rosters, and standings locally. The sim engine can run offline for exhibition games. Live league data requires connectivity.

**Q: Monorepo or separate repos?**
Monorepo (`apps/web`, `apps/ios`, `packages/sim-engine`) — shared types, shared calibration, single CI pipeline.
