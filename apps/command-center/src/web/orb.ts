/**
 * The JARVIS presence.
 *
 * A sphere built from individual points rather than a drawn circle: each point
 * is projected from a real 3-D position, so the form has depth and the far side
 * genuinely sits behind the near side. The wordmark rides across the equator.
 *
 * Its behaviour carries system state — rotation rate, point agitation and
 * colour all follow what the machine is actually doing — and it docks to the
 * screen edge when the command center takes over, staying present without
 * taking space.
 */

export type OrbState = 'STANDBY' | 'THINKING' | 'RESEARCHING' | 'EXECUTING' | 'WAITING' | 'PAUSED' | 'ERROR' | 'COMPLETE';

interface Point {
  /** Position on the unit sphere. */
  x: number;
  y: number;
  z: number;
  /** Per-point jitter so the surface shimmers instead of marching in lockstep. */
  phase: number;
  size: number;
}

interface Profile {
  spin: number;
  agitation: number;
  /** Fraction of points pushed off the surface — reads as activity. */
  scatter: number;
  hue: [number, number, number];
  glow: number;
}

const PROFILES: Record<OrbState, Profile> = {
  STANDBY: { spin: 0.00016, agitation: 0.45, scatter: 0.05, hue: [64, 156, 255], glow: 1 },
  THINKING: { spin: 0.00034, agitation: 0.9, scatter: 0.14, hue: [74, 172, 255], glow: 1.15 },
  RESEARCHING: { spin: 0.0006, agitation: 1.5, scatter: 0.26, hue: [86, 192, 255], glow: 1.35 },
  EXECUTING: { spin: 0.00078, agitation: 1.9, scatter: 0.34, hue: [96, 228, 212], glow: 1.45 },
  WAITING: { spin: 0.00012, agitation: 0.6, scatter: 0.1, hue: [240, 178, 60], glow: 1.05 },
  PAUSED: { spin: 0.00005, agitation: 0.22, scatter: 0.03, hue: [200, 165, 90], glow: 0.62 },
  ERROR: { spin: 0.0002, agitation: 2.4, scatter: 0.4, hue: [239, 106, 90], glow: 1.3 },
  COMPLETE: { spin: 0.0002, agitation: 0.5, scatter: 0.08, hue: [111, 227, 155], glow: 1.15 },
};

const POINT_COUNT = 1500;

/**
 * Fibonacci sphere: points are evenly distributed rather than clustered at the
 * poles, which is what a random distribution would do.
 */
function buildSphere(n: number): Point[] {
  const points: Point[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / (n - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push({
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
      phase: Math.random() * Math.PI * 2,
      size: 0.7 + Math.random() * 1.3,
    });
  }
  return points;
}

export interface OrbLayout {
  /** 0 = centre stage, 1 = fully docked at the edge. */
  dock: number;
  /** Radius in CSS pixels when centred. */
  radius: number;
}

export interface OrbOptions {
  still?: boolean;
  wordmark?: boolean;
  /**
   * 'points' is the sparse sphere used at rest; 'ringed' is the dense core the
   * command center is built around — a lit sphere inside concentric ring bands,
   * ringed by instrument arcs whose motion tracks the work rate.
   */
  form?: 'points' | 'ringed';
}

export class Orb {
  #canvas: HTMLCanvasElement;
  #ctx: CanvasRenderingContext2D | null;
  #points = buildSphere(POINT_COUNT);
  #state: OrbState = 'STANDBY';
  #current: Profile = { ...PROFILES.STANDBY, hue: [...PROFILES.STANDBY.hue] as [number, number, number] };
  #raf = 0;
  #running = false;
  #still: boolean;
  #dock = 0;
  #dockTarget = 0;
  #activity = 0;
  #wordmark = true;
  #form: 'points' | 'ringed';
  /** Rolling amplitude trace, fed by real events, drawn in the status pill. */
  #wave: number[] = new Array(48).fill(0);

  constructor(canvas: HTMLCanvasElement, opts: OrbOptions = {}) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#still = opts.still ?? false;
    this.#wordmark = opts.wordmark ?? true;
    this.#form = opts.form ?? 'points';
  }

  get wave(): number[] {
    return this.#wave;
  }

  set state(s: OrbState) {
    this.#state = s;
  }

  get state(): OrbState {
    return this.#state;
  }

  /** 0 keeps the orb centred; 1 docks it to the right edge. */
  set docked(v: boolean) {
    this.#dockTarget = v ? 1 : 0;
  }

  get docked(): boolean {
    return this.#dockTarget === 1;
  }

  /** A burst of activity: points scatter briefly, then settle. */
  pulse(magnitude = 1): void {
    this.#activity = Math.min(1.6, this.#activity + magnitude * 0.5);
    this.#wave.push(Math.min(1, magnitude));
    if (this.#wave.length > 48) this.#wave.shift();
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const loop = (now: number) => {
      if (!this.#running) return;
      this.#draw(now);
      this.#raf = this.#still
        ? (setTimeout(() => loop(performance.now()), 1000) as unknown as number)
        : requestAnimationFrame(loop);
    };
    this.#raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.#running = false;
    cancelAnimationFrame(this.#raf);
  }

  setStill(still: boolean): void {
    this.stop();
    this.#still = still;
    this.start();
  }

  #draw(now: number): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.#canvas.clientWidth;
    const h = this.#canvas.clientHeight;
    if (this.#canvas.width !== w * dpr || this.#canvas.height !== h * dpr) {
      this.#canvas.width = w * dpr;
      this.#canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const target = PROFILES[this.#state];
    const k = this.#still ? 1 : 0.05;
    this.#current.spin += (target.spin - this.#current.spin) * k;
    this.#current.agitation += (target.agitation - this.#current.agitation) * k;
    this.#current.scatter += (target.scatter - this.#current.scatter) * k;
    this.#current.glow += (target.glow - this.#current.glow) * k;
    for (let i = 0; i < 3; i += 1) {
      const c = this.#current.hue[i] as number;
      this.#current.hue[i] = c + ((target.hue[i] as number) - c) * (this.#still ? 1 : 0.06);
    }
    this.#dock += (this.#dockTarget - this.#dock) * (this.#still ? 1 : 0.07);
    this.#activity *= 0.94;

    const [r, g, b] = this.#current.hue.map(Math.round);
    const rgb = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

    // Centre stage when idle; tucked against the right edge when working.
    const centred = { x: w / 2, y: h * 0.37, radius: Math.min(w, h) * 0.185 };
    const dockedAt = { x: w - Math.min(w, h) * 0.055 - 14, y: h * 0.5, radius: Math.min(w, h) * 0.045 };
    const cx = centred.x + (dockedAt.x - centred.x) * this.#dock;
    const cy = centred.y + (dockedAt.y - centred.y) * this.#dock;
    const radius = centred.radius + (dockedAt.radius - centred.radius) * this.#dock;

    for (let i = 0; i < this.#wave.length; i += 1) this.#wave[i] = (this.#wave[i] as number) * 0.985;

    if (this.#form === 'ringed') {
      this.#drawRinged(ctx, now, cx, cy, radius * 1.7);
      return;
    }

    const spin = now * this.#current.spin;
    const tilt = 0.32;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const agitation = this.#current.agitation + this.#activity * 2;
    const scatter = this.#current.scatter + this.#activity * 0.2;

    // Halo: the diffuse glow the points sit inside. Brightest just inside the
    // silhouette, which is where a lit sphere actually reads as an edge.
    const halo = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.7);
    halo.addColorStop(0, rgb(0.1 * this.#current.glow));
    halo.addColorStop(0.62, rgb(0.14 * this.#current.glow));
    halo.addColorStop(0.86, rgb(0.07 * this.#current.glow));
    halo.addColorStop(1, rgb(0));
    ctx.fillStyle = halo;
    ctx.fillRect(cx - radius * 2, cy - radius * 2, radius * 4, radius * 4);

    // Limb: the faint ring that gives the sphere a definite edge.
    ctx.strokeStyle = rgb(0.2 * this.#current.glow);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.01, 0, Math.PI * 2);
    ctx.stroke();

    const cosS = Math.cos(spin);
    const sinS = Math.sin(spin);

    for (const p of this.#points) {
      // Rotate about Y, then tilt, then project.
      const x1 = p.x * cosS - p.z * sinS;
      const z1 = p.x * sinS + p.z * cosS;
      const y1 = p.y * cosT - z1 * sinT;
      const z2 = p.y * sinT + z1 * cosT;

      // Breathing surface: each point moves on its own phase.
      const wobble = 1 + Math.sin(now * 0.001 * agitation + p.phase) * 0.035 * agitation;
      // A share of points drift outward, which is what activity looks like.
      const out = 1 + (Math.sin(p.phase * 7.3) > 1 - scatter * 2 ? Math.abs(Math.sin(now * 0.0006 + p.phase)) * 0.4 : 0);
      const rr = radius * wobble * out;

      // Perspective: near points are larger and brighter than far ones.
      const depth = (z2 + 1) / 2;
      const px = cx + x1 * rr;
      const py = cy + y1 * rr;
      const size = p.size * (0.45 + depth * 0.85) * Math.max(0.55, radius / centred.radius);
      // Depth shading, plus limb brightening: points seen edge-on pile up along
      // the silhouette, which is what makes a point cloud read as a solid.
      const limb = Math.hypot(x1, y1);
      const alpha = Math.min(1, (0.26 + depth * 0.62) * this.#current.glow * (1 + limb * 0.5));

      ctx.fillStyle = rgb(alpha);
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }

    // Wordmark across the equator, in front of the sphere.
    if (this.#wordmark && this.#dock < 0.45) {
      const fade = 1 - this.#dock / 0.45;
      const fontSize = Math.max(9, radius * 0.2);
      ctx.font = `500 ${fontSize}px ui-monospace, "SF Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const letters = 'JARVIS';
      const spacing = fontSize * 0.42;
      const totalWidth = ctx.measureText(letters).width + spacing * (letters.length - 1);
      let x = cx - totalWidth / 2;
      for (const ch of letters) {
        const cw = ctx.measureText(ch).width;
        ctx.fillStyle = `rgba(238, 246, 255, ${0.94 * fade})`;
        ctx.fillText(ch, x + cw / 2, cy);
        x += cw + spacing;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /**
   * The command center's core: a lit sphere banded by concentric rings, with
   * instrument arcs around it. The arc rates follow the system state, so the
   * ring of activity around the core is literally the work rate.
   */
  #drawRinged(ctx: CanvasRenderingContext2D, now: number, cx: number, cy: number, radius: number): void {
    const glow = this.#current.glow;
    const spin = now * this.#current.spin;
    const core = radius * 0.46;
    const r = Math.round(this.#current.hue[0]);
    const g = Math.round(this.#current.hue[1]);
    const b = Math.round(this.#current.hue[2]);

    // Outer bloom.
    const bloom = ctx.createRadialGradient(cx, cy, core * 0.3, cx, cy, radius * 1.15);
    bloom.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.3 * glow})`);
    bloom.addColorStop(0.42, `rgba(${r}, ${g}, ${b}, ${0.07 * glow})`);
    bloom.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = bloom;
    ctx.fillRect(cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6);

    // The lit sphere: bright centre falling off to a defined edge.
    const body = ctx.createRadialGradient(cx - core * 0.18, cy - core * 0.2, core * 0.05, cx, cy, core);
    body.addColorStop(0, `rgba(${Math.min(255, r + 90)}, ${Math.min(255, g + 60)}, 255, ${0.98 * glow})`);
    body.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${0.9 * glow})`);
    body.addColorStop(0.86, `rgba(${Math.round(r * 0.5)}, ${Math.round(g * 0.6)}, ${Math.round(b * 0.9)}, ${0.7 * glow})`);
    body.addColorStop(1, `rgba(${Math.round(r * 0.3)}, ${Math.round(g * 0.4)}, ${Math.round(b * 0.8)}, ${0.16 * glow})`);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, Math.PI * 2);
    ctx.fill();

    // Everything below is drawn on the sphere itself, so it is clipped to the
    // silhouette: a graticule line must never escape the body it belongs to.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, Math.PI * 2);
    ctx.clip();

    // Latitudes: horizontal ellipses foreshortened toward the poles. Their
    // slight drift is the sphere turning, not decoration.
    const tilt = 0.3;
    const drift = Math.sin(now * 0.0004 * this.#current.agitation) * core * 0.02;
    for (let i = -4; i <= 4; i += 1) {
      const lat = (i / 5) * (Math.PI / 2);
      const y = cy + Math.sin(lat) * core * Math.cos(tilt) + drift;
      const rx = core * Math.cos(lat);
      const ry = Math.max(1, rx * Math.sin(tilt));
      ctx.strokeStyle = `rgba(200, 234, 255, ${(i === 0 ? 0.2 : 0.11) * glow})`;
      ctx.lineWidth = i === 0 ? 1 : 0.7;
      ctx.beginPath();
      ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Meridians: vertical ellipses whose width is the cosine of their turned
    // angle, which is what makes the body read as rotating rather than pulsing.
    for (let i = 0; i < 8; i += 1) {
      const ang = spin * 26 + (i / 8) * Math.PI * 2;
      const rx = Math.abs(Math.cos(ang)) * core;
      if (rx < 0.8) continue;
      ctx.strokeStyle = `rgba(200, 234, 255, ${0.1 * glow})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, core, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Limb darkening: a soft inner shadow that rounds the edge.
    const limb = ctx.createRadialGradient(cx, cy, core * 0.55, cx, cy, core);
    limb.addColorStop(0, 'rgba(0, 0, 0, 0)');
    limb.addColorStop(1, `rgba(1, 6, 12, ${0.5 * glow})`);
    ctx.fillStyle = limb;
    ctx.fillRect(cx - core, cy - core, core * 2, core * 2);

    // Specular: one highlight, offset, so the light has a direction.
    const spec = ctx.createRadialGradient(cx - core * 0.34, cy - core * 0.38, 0, cx - core * 0.34, cy - core * 0.38, core * 0.6);
    spec.addColorStop(0, `rgba(240, 252, 255, ${0.5 * glow})`);
    spec.addColorStop(1, 'rgba(240, 252, 255, 0)');
    ctx.fillStyle = spec;
    ctx.fillRect(cx - core, cy - core, core * 2, core * 2);
    ctx.restore();

    // Rim light along the silhouette.
    ctx.strokeStyle = `rgba(${Math.min(255, r + 70)}, ${Math.min(255, g + 40)}, 255, ${0.5 * glow})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, Math.PI * 2);
    ctx.stroke();

    // Instrument arcs: partial rings at differing radii and rates, with ticks.
    const arcs = [
      { r: 0.56, from: 0.15, len: 1.5, speed: 1, width: 1.2, ticks: 11, warm: false },
      { r: 0.62, from: 2.4, len: 2.1, speed: -0.55, width: 0.9, ticks: 0, warm: false },
      { r: 0.69, from: 4.3, len: 1.1, speed: 0.78, width: 1.6, ticks: 6, warm: true },
      { r: 0.75, from: 1.1, len: 2.8, speed: -0.32, width: 0.8, ticks: 0, warm: false },
      { r: 0.82, from: 3.6, len: 0.9, speed: 0.45, width: 1.1, ticks: 8, warm: false },
      { r: 0.88, from: 0.6, len: 3.4, speed: -0.2, width: 0.7, ticks: 0, warm: false },
      { r: 0.95, from: 5.0, len: 0.55, speed: 0.62, width: 1.8, ticks: 4, warm: true },
      { r: 1.02, from: 2.0, len: 4.6, speed: -0.14, width: 0.6, ticks: 0, warm: false },
      { r: 1.1, from: 3.2, len: 1.35, speed: 0.28, width: 1, ticks: 13, warm: false },
    ];
    for (const a of arcs) {
      const rr = radius * a.r;
      const start = a.from + spin * a.speed * 40;
      ctx.strokeStyle = a.warm ? `rgba(240, 168, 70, ${0.5 * glow})` : `rgba(150, 215, 255, ${0.42 * glow})`;
      ctx.lineWidth = a.width;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, start, start + a.len);
      ctx.stroke();
      for (let t = 0; t < a.ticks; t += 1) {
        const ang = start + (a.len * t) / Math.max(a.ticks - 1, 1);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
        ctx.lineTo(cx + Math.cos(ang) * (rr + 7), cy + Math.sin(ang) * (rr + 7));
        ctx.stroke();
      }
    }

    // Crosshair guides, faint, so the core sits in an instrument rather than space.
    ctx.strokeStyle = `rgba(150, 215, 255, ${0.09 * glow})`;
    ctx.lineWidth = 0.7;
    for (const ang of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * core * 1.15, cy + Math.sin(ang) * core * 1.15);
      ctx.lineTo(cx + Math.cos(ang) * radius * 1.1, cy + Math.sin(ang) * radius * 1.1);
      ctx.stroke();
    }

    if (this.#wordmark) {
      const fontSize = Math.max(9, core * 0.13);
      ctx.font = `500 ${fontSize}px ui-monospace, "SF Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(232, 244, 255, ${0.8 * glow})`;
      ctx.fillText('J.A.R.V.I.S', cx, cy);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }
}
