# 2D Sim — Field Geometry & Animation Model

Quick reference for how the 2D playback works, written for the
"Microleague Baseball" style of fixed ball paths + scripted player movement.

---

## 1. The coordinate system

Everything lives in an 800 × 600 PixiJS canvas. All positions are constants
in [`field/drawField.ts`](field/drawField.ts):

```
FIELD.W = 800
FIELD.H = 600

FIELD.BASE.home   = { x: 400, y: 545 }
FIELD.BASE.first  = { x: 550, y: 395 }
FIELD.BASE.second = { x: 400, y: 245 }
FIELD.BASE.third  = { x: 250, y: 395 }
FIELD.MOUND       = { x: 400, y: 395 }
```

`y` increases **downward** (PIXI convention). The bases form a true square
(side ≈ 212 px, all corners 90°), with home at the bottom and 2B at the top.

Two dugouts sit in foul territory parallel to the foul lines:

```
FIELD.DUGOUT.home    — 3B side, blue,  rotated to match 3B foul line
FIELD.DUGOUT.visitor — 1B side, red,   rotated to match 1B foul line
```

---

## 2. Where the fielders stand

Fielder home positions are an array in
[`engine/AnimationQueue.ts`](engine/AnimationQueue.ts), indexed 0–7:

| Index | Position | `FIELDER_HOME` (x, y)         |
| ----- | -------- | ----------------------------- |
| 0     | Catcher  | (400, 567) — just behind home |
| 1     | 1B       | (565, 430)                    |
| 2     | 2B       | (470, 330)                    |
| 3     | SS       | (335, 330)                    |
| 4     | 3B       | (235, 430)                    |
| 5     | LF       | (170, 200)                    |
| 6     | CF       | (400, 130)                    |
| 7     | RF       | (630, 200)                    |

The pitcher is a separate sprite anchored at `FIELD.MOUND`.

> ⚠️ These positions were chosen to leave the throw paths uncluttered and
> to keep parity with the existing animations — they are **not** anatomically
> perfect MLB positions. See §6 for how to refine them safely.

---

## 3. Sprites

Players are `PIXI.Container`s built by `createPlaceholderPlayer(color, jersey)`
in [`assets/SpriteProvider.ts`](assets/SpriteProvider.ts). Each container holds:

- a colored circle body (10 px radius), and
- a centered jersey number (white text with a black stroke).

Team colors:

```
TEAM_COLOR.home    = 0x3366ff   // blue
TEAM_COLOR.visitor = 0xff3333   // red
```

The batter is colored by the team currently batting; the pitcher and 8
fielders take the fielding team's color.

---

## 4. The animation pipeline

```
GameEngine ─► game_events (DB)
              │
              ▼
   page.tsx maps row → SimEvent (adds batter_hand, batter/pitcher #'s)
              │
              ▼
   buildAnimationQueue(events)  ── deterministic AnimationStep[]
              │
              ▼
   useSimPlayer hook           ── play / pause / speed / stepIndex
              │
              ▼
   FieldCanvas.executeStep()   ── runs each step against PIXI scene
```

### `AnimationStep` types

| Step             | What it does                                                   |
| ---------------- | -------------------------------------------------------------- | --- | ------------- |
| `event_start`    | Spawns / re-skins batter in correct box, re-skins pitcher      |
| `pitcher_windup` | Pitcher rocks back and returns to mound                        |
| `pitch`          | Ball travels mound → home                                      |
| `batter_swing`   | Batter lunges forward, snaps back                              |
| `contact`        | Ball appears at point of contact, flashes                      |
| `ball_flight`    | Ball travels point → point with `line                          | fly | grounder` arc |
| `fielder_move`   | Move a fielder (by id) to a target point                       |
| `fielder_reset`  | Send a fielder back to `FIELDER_HOME[id]`                      |
| `runner_advance` | Walk a runner from one point to another (one base at a time)   |
| `runner_remove`  | Destroy a runner sprite (used for grounders, etc.)             |
| `out`            | Brief red flash at a point                                     |
| `score_update`   | Update HUD score                                               |
| `sound`          | Trigger SFX (currently no-op)                                  |
| `side_change`    | Half-inning swap: defenders run to dugout, new defense emerges |
| `pause`          | Wait `ms` (scaled by speed)                                    |

### Key rule: the batter _is_ the runner

`event_start` creates a single sprite keyed by the event's `seq` and places
it in the L or R batter's box. The **same sprite** is then advanced through
the bases by `runner_advance`. When the runner scores or is removed, the
sprite is destroyed and the next at-bat creates a new one.

---

## 5. Microleague-style ball paths

Like the 1990 Microleague Baseball games, the 2D playback uses a **fixed
script per outcome** rather than physics. Each `AtBatOutcome` (1–7) maps
to a hardcoded sequence of steps with hardcoded ball destinations:

```
Single   → ballTo (470, 280), arc 'line',     batter to 1B
Double   → ballTo (640, 165), arc 'line',     batter to 2B
Triple   → ballTo (160, 145), arc 'fly',      batter to 3B
HomeRun  → ballTo (400, 60),  arc 'fly',      batter trots home
Walk     → no ball flight,    force-advance runners as needed, batter to 1B
GroundOut→ random infield point, fielder picked by x-bucket, throw to 1B
            (1B breaks toward bag if a different infielder fields it)
Strikeout→ swing → out flash at home plate
```

The **fielder follows the ball**, not the other way around — i.e. ball
destinations are the source of truth, and `pickFielder()` chooses the closest
fielder by x-coordinate, then a `fielder_move` tween brings them to the ball.

For ground outs, the first baseman now breaks to a "cover the bag" point
just inside first (`{x: BASE.first.x - 12, y: BASE.first.y + 12}`) before
the throw arrives.

---

## 6. Adjusting fielder positions safely

If you want to nudge a fielder to look more like a real MLB defensive
alignment, **only edit `FIELDER_HOME` in `AnimationQueue.ts`**. Do not move
the bases or change ball-path coordinates.

Rationale: every animation that involves a fielder either

1. moves them to a _ball coordinate_ (`fielder_move` to `ballTo`), or
2. resets them to `FIELDER_HOME[id]` (`fielder_reset`).

Both are absolute targets — they don't depend on where the fielder _was_.
That means you can shift any `FIELDER_HOME[i]` and the only visual change is
where they stand at idle and where they jog back to. None of the ball paths,
throw paths, or runner paths break.

### Suggested guidelines when re-positioning

- **Infielders** (1B, 2B, SS, 3B): keep them just outside the base path
  square (so they're visible against the dirt). Recommend offsetting from
  the corresponding base by a fixed vector, e.g.:
  ```
  1B home = BASE.first  + (+15, +35)
  3B home = BASE.third  + (-15, +35)
  2B home = midpoint(BASE.first,  BASE.second) + (+10, +5)
  SS home = midpoint(BASE.third, BASE.second) + (-10, +5)
  ```
- **Outfielders** (LF, CF, RF): roughly evenly spaced on a shallow arc
  centered on home plate at radius ≈ 320–360. CF should be deeper than
  the corners.
- **Catcher**: `BASE.home + (0, +22)`.
- **Pitcher**: always `FIELD.MOUND` — don't change without also updating
  `pitcher_windup`.

### What to leave alone

- `FIELD.BASE.*` — the bases anchor every animation.
- `pickFielder()` x-bucket thresholds — they assume the current field is
  symmetric around `x = 400`.
- Hit-target ball coordinates (`Single`/`Double`/etc.) — these are tuned so
  the ball lands _near_ an outfielder's home position and the chase tween
  stays short.
- `BATTER_BOX.L` / `BATTER_BOX.R` — placement relative to home plate.

---

## 7. Files at a glance

```
src/components/sim/
├── FieldCanvas.tsx           ← React + PIXI: mounts stage, runs steps
├── FieldCanvasClient.tsx     ← SSR wrapper (next/dynamic, no SSR)
├── POSITIONS.md              ← (this file)
├── assets/
│   ├── SpriteProvider.ts     ← createPlaceholderPlayer / Ball
│   └── SoundProvider.ts      ← SFX interface (no-op stubs for now)
├── engine/
│   ├── AnimationQueue.ts     ← SimEvent → AnimationStep[] (the script)
│   └── useSimPlayer.ts       ← play/pause/speed/seek hook
├── field/
│   └── drawField.ts          ← Static field, bases, dugouts, foul lines
└── renderer/
    ├── BallRenderer.ts       ← gsap pitch + bezier ball flight
    └── RunnerRenderer.ts     ← gsap runner / fielder tween + flash
```
