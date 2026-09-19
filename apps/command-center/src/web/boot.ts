/**
 * Boot sequence.
 *
 * An advanced system powering itself on: one point, a pulse, geometry
 * expanding, a core forming, then the interface materialising outward. Drawn on
 * a single canvas with one requestAnimationFrame loop, so it costs one layer
 * rather than dozens of animated DOM nodes.
 *
 * Honours reduced motion by resolving immediately — the interface is never
 * gated behind an animation the operator cannot skip.
 */

export interface BootStep {
  at: number;
  label: string;
}

/** Each step is a state the operator can read, not decoration. */
export const BOOT_STEPS: BootStep[] = [
  { at: 0, label: 'core seed' },
  { at: 600, label: 'power' },
  { at: 1150, label: 'geometry' },
  { at: 1750, label: 'containment ring' },
  { at: 2350, label: 'orbital sync' },
  { at: 2900, label: 'particle field' },
  { at: 3400, label: 'data nodes' },
  { at: 3950, label: 'interface materialising' },
  { at: 4550, label: 'panels locked' },
  { at: 5050, label: 'systems check' },
  { at: 5500, label: 'jarvis online' },
];

export const BOOT_DURATION = 6200;

interface Node {
  angle: number;
  radius: number;
  speed: number;
  size: number;
}

interface Particle {
  angle: number;
  radius: number;
  drift: number;
  alpha: number;
}

export function runBoot(canvas: HTMLCanvasElement, label: HTMLElement, onDone: () => void, reducedMotion: boolean): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx || reducedMotion) {
    label.textContent = 'jarvis online';
    onDone();
    return () => undefined;
  }

  let raf = 0;
  let stopped = false;
  const start = performance.now();

  const nodes: Node[] = Array.from({ length: 14 }, (_, i) => ({
    angle: (i / 14) * Math.PI * 2,
    radius: 120 + (i % 3) * 34,
    speed: 0.00018 + (i % 4) * 0.00009,
    size: 1.6 + (i % 3) * 0.7,
  }));

  const particles: Particle[] = Array.from({ length: 90 }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 60 + Math.random() * 280,
    drift: (Math.random() - 0.5) * 0.0006,
    alpha: 0.12 + Math.random() * 0.4,
  }));

  function size(): { w: number; h: number; dpr: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    return { w, h, dpr };
  }

  /** Smooth 0→1 ramp used for every stage reveal. */
  function ramp(t: number, from: number, over: number): number {
    return Math.max(0, Math.min(1, (t - from) / over));
  }

  function ease(x: number): number {
    return 1 - Math.pow(1 - x, 3);
  }

  let lastLabel = '';

  function frame(now: number): void {
    if (stopped) return;
    const t = now - start;
    const { w, h, dpr } = size();
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    const step = [...BOOT_STEPS].reverse().find((s) => t >= s.at);
    if (step && step.label !== lastLabel) {
      lastLabel = step.label;
      label.textContent = step.label;
    }

    // 1-2: the seed and its pulse.
    const seed = ease(ramp(t, 0, 500));
    ctx.fillStyle = `rgba(94, 230, 220, ${0.2 + seed * 0.8})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.2 + seed * 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (t > 520) {
      const pulse = ((t - 520) % 1400) / 1400;
      ctx.strokeStyle = `rgba(94, 230, 220, ${0.32 * (1 - pulse)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 6 + pulse * 200, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 3: thin geometry reaching outward.
    const geo = ease(ramp(t, 1150, 700));
    if (geo > 0) {
      ctx.strokeStyle = `rgba(94, 230, 220, ${0.26 * geo})`;
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + t * 0.00004;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16);
        ctx.lineTo(cx + Math.cos(a) * (16 + geo * 250), cy + Math.sin(a) * (16 + geo * 250));
        ctx.stroke();
      }
    }

    // 4-5: the containment ring, then rings at differing rates.
    const ring = ease(ramp(t, 1750, 650));
    if (ring > 0) {
      const rings = [
        { r: 86, speed: 0.00022, dash: [2, 9], width: 1 },
        { r: 118, speed: -0.00014, dash: [14, 8], width: 0.8 },
        { r: 152, speed: 0.00009, dash: [1, 16], width: 0.8 },
      ];
      rings.forEach((r, i) => {
        const on = ease(ramp(t, 1750 + i * 300, 600));
        if (on <= 0) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * r.speed);
        ctx.strokeStyle = `rgba(94, 230, 220, ${0.42 * on})`;
        ctx.lineWidth = r.width;
        ctx.setLineDash(r.dash);
        ctx.beginPath();
        ctx.arc(0, 0, r.r * on, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
      ctx.setLineDash([]);
    }

    // 6: particle field.
    const pf = ease(ramp(t, 2900, 700));
    if (pf > 0) {
      for (const p of particles) {
        p.angle += p.drift;
        const x = cx + Math.cos(p.angle) * p.radius;
        const y = cy + Math.sin(p.angle) * p.radius * 0.62;
        ctx.fillStyle = `rgba(94, 230, 220, ${p.alpha * pf * 0.5})`;
        ctx.fillRect(x, y, 1.1, 1.1);
      }
    }

    // 7: data nodes latch onto the orbits.
    const nd = ease(ramp(t, 3400, 700));
    if (nd > 0) {
      for (const n of nodes) {
        n.angle += n.speed;
        const r = n.radius * nd;
        const x = cx + Math.cos(n.angle) * r;
        const y = cy + Math.sin(n.angle) * r * 0.62;
        ctx.fillStyle = `rgba(94, 230, 220, ${0.75 * nd})`;
        ctx.beginPath();
        ctx.arc(x, y, n.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(94, 230, 220, ${0.1 * nd})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }

    // 8-9: panel frames materialise from the centre and lock outward.
    const panels = ease(ramp(t, 3950, 900));
    if (panels > 0) {
      const frames = [
        { x: 0.04, y: 0.1, w: 0.2, h: 0.62 },
        { x: 0.76, y: 0.1, w: 0.2, h: 0.62 },
        { x: 0.04, y: 0.78, w: 0.58, h: 0.16 },
        { x: 0.64, y: 0.78, w: 0.32, h: 0.16 },
        { x: 0.04, y: 0.03, w: 0.92, h: 0.05 },
      ];
      ctx.strokeStyle = `rgba(94, 230, 220, ${0.34 * panels})`;
      ctx.lineWidth = 1;
      for (const f of frames) {
        const fx = cx + (f.x * w - cx) * panels;
        const fy = cy + (f.y * h - cy) * panels;
        ctx.strokeRect(fx, fy, f.w * w * panels, f.h * h * panels);
      }
    }

    // 11: the core locks and the system declares itself ready.
    const lock = ease(ramp(t, 5050, 700));
    if (lock > 0) {
      ctx.strokeStyle = `rgba(94, 230, 220, ${0.9 * lock})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, 44, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lock);
      ctx.stroke();
    }

    if (t >= BOOT_DURATION) {
      onDone();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
