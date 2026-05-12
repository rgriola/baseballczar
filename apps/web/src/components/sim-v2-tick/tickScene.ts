// Last touched by agent: 2026-05-05T08:02:00Z
/**
 * Tick-based scene renderer.
 *
 * Reads WorldSnapshot arrays and draws the Pixi scene. Reuses the
 * same field drawing, coordinate system, and sprite factories as
 * sim-v2 — the difference is that positions come from tick snapshots
 * rather than tween targets.
 *
 * Each frame, the renderer interpolates between the two nearest
 * snapshots to produce smooth movement even when the tick rate
 * doesn't exactly match the display refresh rate.
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { WorldSnapshot, FielderEntity, RunnerEntity, BallEntity, GameState } from '@baseballczar/tick-engine';
import { makeTransform, ftToPx, type FieldTransform, type CanvasSize } from '../sim-v2/coords';
import { buildField } from '../sim-v2/field/drawField';
import { makeFielderSprite, makeRunnerSprite } from '../sim-v2/scene/sprites';
import type { Position } from '@baseballczar/sim-engine';

export interface TickSceneOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export type ViewMode = 'full' | 'infield' | 'ball';

export interface EventDispatchMeta {
  snapIdx: number;
  playbackTime: number;
  fielderCount: number;
  runnerCount: number;
  ballState: BallEntity['state']['type'];
}

export interface DebugPlayerLookup {
  [playerId: number]: {
    lastName: string;
    position: string;
    jerseyNumber?: number;
  };
}

export class TickScene {
  private app: Application;
  private transform!: FieldTransform;
  private fieldLayer = new Container();
  private entityLayer = new Container({ sortableChildren: true });
  private initialized = false;
  private destroyed = false;

  /** Root container for zoom/pan — fieldLayer and entityLayer are children. */
  private camera = new Container();

  // Camera state
  private cameraZoom = 1;
  private cameraPanX = 0;
  private cameraPanY = 0;
  private targetZoom = 1;
  private targetPanX = 0;
  private targetPanY = 0;
  private viewMode: ViewMode = 'full';

  // Drag-pan state
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragPanStartX = 0;
  private dragPanStartY = 0;

  // Fielder sprites indexed by position
  private fielderSprites = new Map<string, {
    container: Container;
    body: Graphics;
    hat: Graphics;
    hatOffsetPx: number;
    debugTag: Text;
  }>();

  // Ball sprite
  private ballGfx!: Graphics;
  private ballShadow!: Graphics;

  /** Last known ball position (for 'ball' view tracking). */
  private lastBallPx = { x: 0, y: 0 };

  // Runner sprites indexed by runner id
  private runnerSprites = new Map<number, {
    container: Container;
    hat: Graphics;
    hatOffsetPx: number;
    debugTag: Text;
  }>();
  private readonly RUNNER_COLOR = 0xd4442a;  // red-orange for runners
  private readonly DEBUG_TAG_OFFSET_PX = 10;
  private showDebugPlayerTags = false;
  private debugPlayerLookup = new Map<number, { lastName: string; position: string; jerseyNumber: number }>();

  // Playback state
  private snapshots: WorldSnapshot[] = [];
  private playbackTime = 0;
  private speed = 1;
  private playing = false;

  // Event callback
  private onEvent?: (events: WorldSnapshot['events'], time: number, meta?: EventDispatchMeta) => void;
  /** Index of the last snapshot whose events we already emitted. */
  private lastEventSnapIdx = -1;

  // HUD elements (above camera — not affected by zoom/pan)
  private hudLayer = new Container();
  private hudInningText!: Text;
  private hudHalfArrow!: Text;
  private hudScoreText!: Text;
  private hudOutDots: Graphics[] = [];
  private hudBaseDiamond!: Graphics;
  private hudBaseIndicators: { first: Graphics; second: Graphics; third: Graphics } = {} as any;
  private hudBatterText!: Text;
  private hudPitcherText!: Text;
  private lastGameState?: GameState;

  constructor(private opts: TickSceneOptions) {
    this.app = new Application();
  }

  async init(): Promise<void> {
    if (this.destroyed) return;  // already torn down before init finished

    await this.app.init({
      canvas: this.opts.canvas,
      width: this.opts.width,
      height: this.opts.height,
      backgroundColor: 0x1a3d1a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    if (this.destroyed) return;  // check again after async gap
    this.initialized = true;

    const size: CanvasSize = { width: this.opts.width, height: this.opts.height };
    this.transform = makeTransform(size, { maxFt: 420 });

    // Camera container wraps everything for zoom/pan
    this.camera.pivot.set(this.opts.width / 2, this.opts.height / 2);
    this.camera.position.set(this.opts.width / 2, this.opts.height / 2);
    this.app.stage.addChild(this.camera);

    // Draw the static field
    const field = buildField(size, this.transform);
    this.fieldLayer = field.root;
    this.camera.addChild(this.fieldLayer);

    // Entity layer on top
    this.camera.addChild(this.entityLayer);

    // Create ball shadow — small on ground, grows when ball is airborne
    this.ballShadow = new Graphics()
      .ellipse(0, 0, 2.5, 1.5)
      .fill({ color: 0x000000, alpha: 0.6 });
    this.entityLayer.addChild(this.ballShadow);

    // Ball — small base size at ground level; scales up when airborne
    this.ballGfx = new Graphics()
      .circle(0, 0, 1.25)
      .fill(0xffffff);
    this.entityLayer.addChild(this.ballGfx);

    // Mouse-wheel zoom on the canvas
    this.opts.canvas.addEventListener('wheel', this.handleWheel, { passive: false });

    // Drag-pan: grab cursor
    this.opts.canvas.style.cursor = 'grab';
    this.opts.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);

    // HUD overlay (above camera, fixed position)
    this.buildHUD();
    this.app.stage.addChild(this.hudLayer);

    // Start the render loop
    this.app.ticker.add(() => this.tick());
  }

  /** Load snapshots for playback. */
  loadSnapshots(
    snapshots: WorldSnapshot[],
    onEvent?: (events: WorldSnapshot['events'], time: number, meta?: EventDispatchMeta) => void,
  ): void {
    this.snapshots = snapshots;
    this.playbackTime = 0;
    this.lastEventSnapIdx = -1;
    this.onEvent = onEvent;

    // Create fielder sprites from the first snapshot
    if (snapshots.length > 0) {
      this.createFielderSprites(snapshots[0].fielders);
    }
  }

  play(speed = 1): void {
    this.speed = speed;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /** Seek to a specific time (seconds). */
  seek(time: number): void {
    this.playbackTime = Math.max(0, Math.min(time, this.getDuration()));
    // Align event cursor to the target snapshot so seek doesn't replay history.
    const { snapIdx } = this.findSnapshots(this.playbackTime);
    this.lastEventSnapIdx = snapIdx;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  setDebugPlayerTags(enabled: boolean, lookup: DebugPlayerLookup = {}): void {
    this.showDebugPlayerTags = enabled;
    this.debugPlayerLookup.clear();

    for (const [id, info] of Object.entries(lookup)) {
      const playerId = Number(id);
      if (!Number.isFinite(playerId) || !info) continue;
      this.debugPlayerLookup.set(playerId, {
        lastName: info.lastName,
        position: info.position,
        jerseyNumber: info.jerseyNumber ?? 0,
      });
    }
  }

  getTime(): number {
    return this.playbackTime;
  }

  getDuration(): number {
    if (this.snapshots.length === 0) return 0;
    return this.snapshots[this.snapshots.length - 1].time;
  }

  isFinished(): boolean {
    return this.playbackTime >= this.getDuration();
  }

  /** Set view mode: 'full' (default), 'infield' (zoomed), or 'ball' (follow ball). */
  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    switch (mode) {
      case 'full':
        this.targetZoom = 1;
        this.targetPanX = 0;
        this.targetPanY = 0;
        break;
      case 'infield':
        this.targetZoom = 2.2;
        // Center on the infield diamond (second base area)
        const ifPx = ftToPx({ x: 0, y: 90 }, this.transform);
        this.targetPanX = (this.opts.width / 2 - ifPx.x) * this.targetZoom;
        this.targetPanY = (this.opts.height / 2 - ifPx.y) * this.targetZoom;
        break;
      case 'ball':
        // Ball tracking is dynamic — handled each tick
        this.targetZoom = 2.5;
        break;
    }
  }

  getViewMode(): ViewMode {
    return this.viewMode;
  }

  destroy(): void {
    this.destroyed = true;
    this.playing = false;
    this.opts.canvas.removeEventListener('wheel', this.handleWheel);
    this.opts.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    if (this.initialized) {
      try {
        this.app.destroy(true);
      } catch {
        // Pixi may throw if not fully set up — safe to ignore on teardown
      }
    }
  }

  // ─── Zoom/pan handlers ──────────────────────────────────────────

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Pinch-zoom (ctrlKey set by trackpad pinch) or scroll-zoom
    const zoomDelta = e.ctrlKey ? -e.deltaY * 0.01 : -e.deltaY * 0.003;
    this.targetZoom = Math.max(0.8, Math.min(3, this.targetZoom + zoomDelta));
    this.viewMode = 'full';  // break out of preset modes on manual zoom
  };

  private handleMouseDown = (e: MouseEvent): void => {
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragPanStartX = this.targetPanX;
    this.dragPanStartY = this.targetPanY;
    this.opts.canvas.style.cursor = 'grabbing';
    this.viewMode = 'full';  // break out of preset modes
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    this.targetPanX = this.dragPanStartX + dx;
    this.targetPanY = this.dragPanStartY + dy;
  };

  private handleMouseUp = (): void => {
    this.dragging = false;
    this.opts.canvas.style.cursor = 'grab';
  };

  // ─── Private ─────────────────────────────────────────────────

  private createFielderSprites(fielders: FielderEntity[]): void {
    // Clear old sprites
    for (const [, sp] of this.fielderSprites) {
      this.entityLayer.removeChild(sp.container);
    }
    this.fielderSprites.clear();

    const radiusPx = Math.max(4, this.transform.scale * 3);

    for (const f of fielders) {
      const { c, body, hat, hatOffsetPx } = makeFielderSprite(f.position as Position, radiusPx);
      const debugTag = this.makeDebugTag(radiusPx);
      c.addChild(debugTag);
      body.tint = f.teamColor;
      const px = ftToPx(f.pos, this.transform);
      c.position.set(px.x, px.y);
      this.entityLayer.addChild(c);
      this.fielderSprites.set(f.position, { container: c, body, hat, hatOffsetPx, debugTag });
    }
  }

  private makeDebugTag(radiusPx: number): Text {
    const tag = new Text({
      text: '',
      style: {
        fill: 0xffffff,
        fontSize: 10,
        fontFamily: 'monospace',
        fontWeight: '700',
        stroke: { color: 0x000000, width: 3, join: 'round' },
      },
    });
    tag.anchor.set(0.5, 1);
    tag.position.set(0, -radiusPx - this.DEBUG_TAG_OFFSET_PX);
    tag.visible = false;
    return tag;
  }

  private displayPosition(pos: string): string {
    if (pos === 'B1') return '1B';
    if (pos === 'B2') return '2B';
    if (pos === 'B3') return '3B';
    return pos;
  }

  private tick(): void {
    if (this.snapshots.length === 0) return;

    if (this.playing) {
      const dt = this.app.ticker.deltaMS / 1000;
      this.playbackTime += dt * this.speed;

      // Clamp to end
      const maxTime = this.snapshots[this.snapshots.length - 1].time;
      if (this.playbackTime > maxTime) {
        this.playbackTime = maxTime;
        this.playing = false;
      }
    }

    // Smooth camera interpolation (always runs, even when paused)
    const camLerp = 0.08;
    this.cameraZoom += (this.targetZoom - this.cameraZoom) * camLerp;
    this.cameraPanX += (this.targetPanX - this.cameraPanX) * camLerp;
    this.cameraPanY += (this.targetPanY - this.cameraPanY) * camLerp;

    this.camera.scale.set(this.cameraZoom);

    // Clamp pan so the field can't be pushed entirely off-screen.
    // Allow at most 40% of the canvas width/height as drift.
    const maxDriftX = this.opts.width * 0.4;
    const maxDriftY = this.opts.height * 0.4;
    this.cameraPanX = Math.max(-maxDriftX, Math.min(maxDriftX, this.cameraPanX));
    this.cameraPanY = Math.max(-maxDriftY, Math.min(maxDriftY, this.cameraPanY));
    // Also clamp the targets so they don't keep pulling beyond the boundary
    this.targetPanX = Math.max(-maxDriftX, Math.min(maxDriftX, this.targetPanX));
    this.targetPanY = Math.max(-maxDriftY, Math.min(maxDriftY, this.targetPanY));

    this.camera.position.set(
      this.opts.width / 2 + this.cameraPanX,
      this.opts.height / 2 + this.cameraPanY,
    );

    // Find the two bounding snapshots for interpolation
    const { snap, nextSnap, u, snapIdx } = this.findSnapshots(this.playbackTime);
    if (!snap) return;

    // Update ball
    this.updateBall(snap.ball, nextSnap?.ball, u);

    // Ball-tracking view: update camera target to follow ball
    if (this.viewMode === 'ball') {
      this.targetPanX = (this.opts.width / 2 - this.lastBallPx.x) * this.targetZoom;
      this.targetPanY = (this.opts.height / 2 - this.lastBallPx.y) * this.targetZoom;
    }

    // Update fielders
    this.updateFielders(snap.fielders, nextSnap?.fielders, u);

    // Update runners
    this.updateRunners(snap.runners, nextSnap?.runners, u);

    // Fire every event-bearing snapshot crossed this frame.
    if (this.playing && snapIdx > this.lastEventSnapIdx) {
      const startIdx = Math.max(0, this.lastEventSnapIdx + 1);
      const endIdx = Math.min(snapIdx, this.snapshots.length - 1);

      for (let idx = startIdx; idx <= endIdx; idx++) {
        const evtSnap = this.snapshots[idx];
        if (evtSnap.events.length === 0) continue;
        this.onEvent?.(evtSnap.events, evtSnap.time, {
          snapIdx: idx,
          playbackTime: this.playbackTime,
          fielderCount: evtSnap.fielders.length,
          runnerCount: evtSnap.runners.length,
          ballState: evtSnap.ball.state.type,
        });
      }

      this.lastEventSnapIdx = endIdx;
    }

    // Update HUD overlay
    if (snap.gameState) {
      this.updateHUD(snap.gameState);
    }
  }

  private findSnapshots(time: number): {
    snap: WorldSnapshot | null;
    nextSnap: WorldSnapshot | null;
    u: number;
    snapIdx: number;
  } {
    const snaps = this.snapshots;
    if (snaps.length === 0) return { snap: null, nextSnap: null, u: 0, snapIdx: -1 };

    // Binary search for the snapshot just before `time`
    let lo = 0, hi = snaps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (snaps[mid].time <= time) lo = mid;
      else hi = mid - 1;
    }

    const snap = snaps[lo];
    const nextSnap = lo + 1 < snaps.length ? snaps[lo + 1] : null;
    const u = nextSnap
      ? (time - snap.time) / (nextSnap.time - snap.time)
      : 0;

    return { snap, nextSnap, u: Math.max(0, Math.min(1, u)), snapIdx: lo };
  }

  private updateBall(ball: BallEntity, nextBall: BallEntity | undefined, u: number): void {
    // Interpolate position
    let x = ball.pos.x;
    let y = ball.pos.y;
    let z = ball.pos.z;

    if (nextBall) {
      x += (nextBall.pos.x - x) * u;
      y += (nextBall.pos.y - y) * u;
      z += (nextBall.pos.z - z) * u;
    }

    const px = ftToPx({ x, y }, this.transform);
    const lift = z * this.transform.scale * 0.6;

    this.lastBallPx = { x: px.x, y: px.y - lift };
    this.ballGfx.position.set(px.x, px.y - lift);
    this.ballShadow.position.set(px.x, px.y);

    // ── Altitude-based ball scaling ──
    // Ball is small at ground level (1.0×) and grows when airborne
    // to create the perception of rising toward the viewer.
    // At 100ft altitude it's ~2.5× its ground size.
    const altScale = 1.0 + Math.min(z / 60, 1.5);
    this.ballGfx.scale.set(altScale);

    // ── Shadow: grows with altitude ──
    // Ground ball = small, tight shadow. Fly ball = large, spread shadow
    // (acts as a landing zone indicator for high fly balls).
    const shadowScale = 0.5 + Math.min(z / 30, 2.5);
    this.ballShadow.scale.set(shadowScale);
    this.ballShadow.alpha = Math.min(0.7, 0.15 + z / 50);

    // ── Z-ordering ──
    // Shadow stays under everything. Ball renders above all entities
    // when airborne (z > 5 ft), otherwise sorts by y like fielders.
    this.ballShadow.zIndex = 0;
    if (z > 5) {
      // Airborne: render above all ground entities (fielders at ~1000 max)
      this.ballGfx.zIndex = 2000;
    } else {
      // On/near ground: sort with other entities by y-position
      this.ballGfx.zIndex = Math.round(px.y) + 1;
    }

    // Hide ball if it's idle (in a glove)
    const isVisible = ball.state.type !== 'idle' && ball.state.type !== 'held';
    this.ballGfx.visible = isVisible;
    this.ballShadow.visible = isVisible;
  }

  private updateFielders(
    fielders: FielderEntity[],
    nextFielders: FielderEntity[] | undefined,
    u: number,
  ): void {
    const radiusPx = Math.max(4, this.transform.scale * 3);

    for (let i = 0; i < fielders.length; i++) {
      const f = fielders[i];
      let sp = this.fielderSprites.get(f.position);

      // Auto-create sprite if it doesn't exist yet
      // (handles inning changes, late initialization, or data order issues)
      if (!sp) {
        const { c, body, hat, hatOffsetPx } = makeFielderSprite(f.position as Position, radiusPx);
        const debugTag = this.makeDebugTag(radiusPx);
        c.addChild(debugTag);
        body.tint = f.teamColor;
        this.entityLayer.addChild(c);
        sp = { container: c, body, hat, hatOffsetPx, debugTag };
        this.fielderSprites.set(f.position, sp);
      }

      // Update team color if it changed (inning swap)
      if (f.teamColor) {
        sp.body.tint = f.teamColor;
      }

      let x = f.pos.x;
      let y = f.pos.y;
      const nf = nextFielders?.find((candidate) => candidate.position === f.position);

      // Interpolate with next snapshot
      if (nf) {
        x += (nf.pos.x - x) * u;
        y += (nf.pos.y - y) * u;
      }

      const px = ftToPx({ x, y }, this.transform);
      sp.container.position.set(px.x, px.y);
      sp.container.zIndex = Math.round(px.y);

      // Update hat from explicit fielder facing (sim-engine turn model).
      if (typeof f.facingRad === 'number') {
        let facing = f.facingRad;
        if (nf && typeof nf.facingRad === 'number') {
          facing = this.interpolateAngle(f.facingRad, nf.facingRad, u);
        }
        sp.hat.rotation = facing;
      } else if (nf) {
        const dx = nf.pos.x - f.pos.x;
        const dy = nf.pos.y - f.pos.y;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          sp.hat.rotation = Math.atan2(-dy, dx);
        }
      }

      const rosterInfo = this.debugPlayerLookup.get(f.playerId);
      const jerseyNo = f.jerseyNumber > 0 ? f.jerseyNumber : f.playerId;
      const jerseyStr = String(jerseyNo).padStart(2, '0');
      const lastName = rosterInfo?.lastName ?? 'Unknown';
      const posLabel = this.displayPosition(f.position);
      sp.debugTag.text = `${posLabel} #${jerseyStr} ${lastName}`;
      sp.debugTag.position.set(0, -radiusPx - this.DEBUG_TAG_OFFSET_PX);
      sp.debugTag.visible = this.showDebugPlayerTags;
    }
  }

  private updateRunners(
    runners: RunnerEntity[],
    nextRunners: RunnerEntity[] | undefined,
    u: number,
  ): void {
    const radiusPx = Math.max(4, this.transform.scale * 3);
    const activeIds = new Set<number>();

    for (let i = 0; i < runners.length; i++) {
      const r = runners[i];
      activeIds.add(r.id);

      // Create sprite if it doesn't exist
      if (!this.runnerSprites.has(r.id)) {
        const { c, hat, hatOffsetPx } = makeRunnerSprite(this.RUNNER_COLOR, radiusPx);
        const debugTag = this.makeDebugTag(radiusPx);
        c.addChild(debugTag);
        this.entityLayer.addChild(c);
        this.runnerSprites.set(r.id, { container: c, hat, hatOffsetPx, debugTag });
      }

      const sp = this.runnerSprites.get(r.id)!;

      let x = r.pos.x;
      let y = r.pos.y;

      // Interpolate with next snapshot
      if (nextRunners) {
        const nr = nextRunners.find(nr => nr.id === r.id);
        if (nr) {
          x += (nr.pos.x - x) * u;
          y += (nr.pos.y - y) * u;
        }
      }

      const px = ftToPx({ x, y }, this.transform);
      sp.container.position.set(px.x, px.y);
      // Depth sort: same as fielders
      sp.container.zIndex = Math.round(px.y);

      // Update hat facing direction
      if (nextRunners) {
        const nr = nextRunners.find(nr => nr.id === r.id);
        if (nr) {
          if (typeof r.facingRad === 'number' && typeof nr.facingRad === 'number') {
            sp.hat.rotation = this.interpolateAngle(r.facingRad, nr.facingRad, u);
          } else {
            const dx = nr.pos.x - r.pos.x;
            const dy = nr.pos.y - r.pos.y;
            if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
              const angle = Math.atan2(-dy, dx);
              sp.hat.rotation = angle;
            }
          }
        } else if (typeof r.facingRad === 'number') {
          sp.hat.rotation = r.facingRad;
        }
      } else if (typeof r.facingRad === 'number') {
        sp.hat.rotation = r.facingRad;
      }

      // Hide scored runners
      const runnerVisible = r.state.type !== 'scored';
      sp.container.visible = runnerVisible;

      const rosterInfo = this.debugPlayerLookup.get(r.id);
      const posLabel = rosterInfo?.position ?? 'RUN';
      const jerseyNo = rosterInfo?.jerseyNumber && rosterInfo.jerseyNumber > 0
        ? rosterInfo.jerseyNumber : r.id;
      const jerseyStr = String(jerseyNo).padStart(2, '0');
      const lastName = rosterInfo?.lastName ?? 'Unknown';
      sp.debugTag.text = `${posLabel} #${jerseyStr} ${lastName}`;
      sp.debugTag.position.set(0, -radiusPx - this.DEBUG_TAG_OFFSET_PX);
      sp.debugTag.visible = this.showDebugPlayerTags && runnerVisible;
    }

    // Remove sprites for runners no longer in the snapshot
    for (const [id, sp] of this.runnerSprites) {
      if (!activeIds.has(id)) {
        this.entityLayer.removeChild(sp.container);
        this.runnerSprites.delete(id);
      }
    }
  }

  private interpolateAngle(from: number, to: number, u: number): number {
    const delta = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return from + delta * u;
  }

  // ─── Scoreboard HUD ─────────────────────────────────────────────

  private buildHUD(): void {
    const W = this.opts.width;
    const panelW = 200;
    const panelH = 100;
    const panelX = W - panelW - 12;
    const panelY = 12;

    // Semi-transparent background panel
    const bg = new Graphics()
      .roundRect(panelX, panelY, panelW, panelH, 8)
      .fill({ color: 0x0a0a14, alpha: 0.85 })
      .stroke({ color: 0x3a3a4e, width: 1, alpha: 0.6 });
    this.hudLayer.addChild(bg);

    const textStyle = { fill: 0xffffff, fontSize: 11, fontFamily: 'system-ui' };
    const dimStyle = { fill: 0x888899, fontSize: 9, fontFamily: 'system-ui' };

    // Inning: "▲ 3" or "▼ 3"
    this.hudHalfArrow = new Text({ text: '▲', style: { ...textStyle, fontSize: 10 } });
    this.hudHalfArrow.position.set(panelX + 10, panelY + 8);
    this.hudLayer.addChild(this.hudHalfArrow);

    this.hudInningText = new Text({ text: '1', style: { ...textStyle, fontSize: 14, fontWeight: '700' } });
    this.hudInningText.position.set(panelX + 22, panelY + 5);
    this.hudLayer.addChild(this.hudInningText);

    // Score
    this.hudScoreText = new Text({ text: '0 - 0', style: { ...textStyle, fontSize: 13, fontWeight: '600' } });
    this.hudScoreText.anchor.set(1, 0);
    this.hudScoreText.position.set(panelX + panelW - 10, panelY + 6);
    this.hudLayer.addChild(this.hudScoreText);

    // Out dots: 3 small circles
    const outY = panelY + 28;
    for (let i = 0; i < 3; i++) {
      const dot = new Graphics()
        .circle(panelX + 10 + i * 14, outY, 4)
        .fill({ color: 0x444455, alpha: 1 })
        .stroke({ color: 0x666677, width: 0.5 });
      this.hudLayer.addChild(dot);
      this.hudOutDots.push(dot);
    }

    const outsLabel = new Text({ text: 'OUT', style: dimStyle });
    outsLabel.position.set(panelX + 52, outY - 5);
    this.hudLayer.addChild(outsLabel);

    // Base diamond: small diamond shape with 3 base indicators
    const dX = panelX + panelW - 40;
    const dY = panelY + 50;
    const dS = 12; // half-size of the diamond

    // Diamond outline
    this.hudBaseDiamond = new Graphics()
      .poly([dX, dY - dS, dX + dS, dY, dX, dY + dS, dX - dS, dY])
      .stroke({ color: 0x555566, width: 1 });
    this.hudLayer.addChild(this.hudBaseDiamond);

    // Base indicators (small filled diamonds)
    const makeBaseInd = (bx: number, by: number) => {
      const s = 4;
      const g = new Graphics()
        .poly([bx, by - s, bx + s, by, bx, by + s, bx - s, by])
        .fill({ color: 0x444455 });
      this.hudLayer.addChild(g);
      return g;
    };
    this.hudBaseIndicators = {
      first:  makeBaseInd(dX + dS, dY),
      second: makeBaseInd(dX, dY - dS),
      third:  makeBaseInd(dX - dS, dY),
    };

    // Batter / Pitcher text
    const bpX = panelX + 10;
    const batterIcon = new Text({ text: '⚙', style: dimStyle });
    batterIcon.position.set(bpX, panelY + 48);
    this.hudLayer.addChild(batterIcon);

    this.hudBatterText = new Text({ text: '', style: { ...textStyle, fontSize: 10 } });
    this.hudBatterText.position.set(bpX + 12, panelY + 47);
    this.hudLayer.addChild(this.hudBatterText);

    const pitcherIcon = new Text({ text: '⚾', style: dimStyle });
    pitcherIcon.position.set(bpX, panelY + 63);
    this.hudLayer.addChild(pitcherIcon);

    this.hudPitcherText = new Text({ text: '', style: { ...textStyle, fontSize: 10 } });
    this.hudPitcherText.position.set(bpX + 12, panelY + 62);
    this.hudLayer.addChild(this.hudPitcherText);

    // "AWAY - HOME" label under the score
    const teamLabel = new Text({ text: 'AWAY - HOME', style: { ...dimStyle, fontSize: 7 } });
    teamLabel.anchor.set(1, 0);
    teamLabel.position.set(panelX + panelW - 10, panelY + 22);
    this.hudLayer.addChild(teamLabel);
  }

  private updateHUD(gs: GameState): void {
    // Avoid unnecessary updates if the state hasn't changed
    if (this.lastGameState === gs) return;
    this.lastGameState = gs;

    // Inning
    this.hudInningText.text = String(gs.inning);
    this.hudHalfArrow.text = gs.half === 'top' ? '▲' : '▼';

    // Score
    this.hudScoreText.text = `${gs.awayScore} - ${gs.homeScore}`;

    // Outs
    for (let i = 0; i < 3; i++) {
      const isOut = i < gs.outs;
      this.hudOutDots[i].tint = isOut ? 0xf5d76e : 0x444455;
    }

    // Bases
    const baseColor = (occupied: boolean) => occupied ? 0xf5d76e : 0x444455;
    this.hudBaseIndicators.first.tint = baseColor(gs.basesOccupied.first);
    this.hudBaseIndicators.second.tint = baseColor(gs.basesOccupied.second);
    this.hudBaseIndicators.third.tint = baseColor(gs.basesOccupied.third);

    // Batter / Pitcher
    this.hudBatterText.text = gs.batter;
    this.hudPitcherText.text = gs.pitcher;
  }
}
