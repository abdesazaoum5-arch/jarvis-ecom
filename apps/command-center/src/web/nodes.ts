/**
 * Candidate field.
 *
 * Every candidate is a node that physically moves between four zones as its
 * status changes, so the funnel is visible rather than described. Rejected
 * nodes travel to the rejection zone and carry their reason — the interface
 * never quietly drops a candidate.
 */

export type NodeStage = 'DISCOVERED' | 'INVESTIGATING' | 'VALIDATED' | 'REJECTED';

export interface FieldNode {
  id: string;
  name: string;
  stage: NodeStage;
  score: number | null;
  reason: string | null;
  /** Live position, eased towards the zone target. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** 0→1 entry animation. */
  born: number;
}

const ZONES: Record<NodeStage, { cx: number; spread: number; label: string }> = {
  DISCOVERED: { cx: 0.14, spread: 0.1, label: 'discovered' },
  INVESTIGATING: { cx: 0.4, spread: 0.12, label: 'investigating' },
  VALIDATED: { cx: 0.68, spread: 0.1, label: 'validated' },
  REJECTED: { cx: 0.9, spread: 0.08, label: 'rejected' },
};

export class NodeField {
  #canvas: HTMLCanvasElement;
  #ctx: CanvasRenderingContext2D | null;
  #nodes = new Map<string, FieldNode>();
  #raf = 0;
  #running = false;
  #still: boolean;
  #hover: FieldNode | null = null;

  constructor(canvas: HTMLCanvasElement, still = false) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#still = still;
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.#hover = this.#nodeAt(e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = this.#hover ? 'pointer' : 'default';
    });
    canvas.addEventListener('mouseleave', () => {
      this.#hover = null;
    });
  }

  /** Reconciles the field with the live candidate list. */
  sync(candidates: Array<{ id: string; name: string; stage: NodeStage; score: number | null; reason: string | null }>): void {
    const seen = new Set<string>();
    for (const c of candidates) {
      seen.add(c.id);
      const existing = this.#nodes.get(c.id);
      if (existing) {
        existing.stage = c.stage;
        existing.score = c.score;
        existing.reason = c.reason;
      } else {
        const w = this.#canvas.clientWidth || 600;
        const h = this.#canvas.clientHeight || 190;
        this.#nodes.set(c.id, {
          ...c,
          // New nodes scale up from the left edge rather than appearing at rest.
          x: w * 0.06,
          y: h / 2,
          tx: 0,
          ty: 0,
          born: 0,
        });
      }
    }
    for (const id of [...this.#nodes.keys()]) if (!seen.has(id)) this.#nodes.delete(id);
    this.#assign();
  }

  #assign(): void {
    const w = this.#canvas.clientWidth || 600;
    const h = this.#canvas.clientHeight || 190;
    const groups = new Map<NodeStage, FieldNode[]>();
    for (const n of this.#nodes.values()) {
      const list = groups.get(n.stage) ?? [];
      list.push(n);
      groups.set(n.stage, list);
    }
    for (const [stage, list] of groups) {
      const zone = ZONES[stage];
      const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
      list.forEach((n, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const rows = Math.ceil(list.length / cols);
        n.tx = w * zone.cx + (col - (cols - 1) / 2) * (w * zone.spread) / Math.max(cols, 1);
        n.ty = h * 0.46 + (row - (rows - 1) / 2) * 20;
      });
    }
  }

  #nodeAt(x: number, y: number): FieldNode | null {
    for (const n of this.#nodes.values()) {
      if (Math.hypot(n.x - x, n.y - y) < 9) return n;
    }
    return null;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const loop = () => {
      if (!this.#running) return;
      this.#draw();
      this.#raf = this.#still ? (setTimeout(loop, 900) as unknown as number) : requestAnimationFrame(loop);
    };
    loop();
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

  #draw(): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.#canvas.clientWidth;
    const h = this.#canvas.clientHeight;
    if (this.#canvas.width !== w * dpr || this.#canvas.height !== h * dpr) {
      this.#canvas.width = w * dpr;
      this.#canvas.height = h * dpr;
      this.#assign();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Zone separators and labels: the funnel itself.
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const [stage, zone] of Object.entries(ZONES) as Array<[NodeStage, (typeof ZONES)[NodeStage]]>) {
      const x = w * zone.cx;
      ctx.strokeStyle = stage === 'REJECTED' ? 'rgba(239, 106, 90, 0.14)' : 'rgba(94, 230, 220, 0.09)';
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, h - 26);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = stage === 'REJECTED' ? 'rgba(239, 106, 90, 0.4)' : 'rgba(76, 98, 109, 0.85)';
      ctx.fillText(zone.label.toUpperCase(), x, 14);
    }

    for (const n of this.#nodes.values()) {
      // Spring towards the zone target; movement between zones is the signal.
      n.x += (n.tx - n.x) * 0.12;
      n.y += (n.ty - n.y) * 0.12;
      n.born = Math.min(1, n.born + 0.06);
      const s = 1 - Math.pow(1 - n.born, 3);

      const rejected = n.stage === 'REJECTED';
      const validated = n.stage === 'VALIDATED';
      const colour = rejected ? '239, 106, 90' : validated ? '111, 227, 155' : '94, 230, 220';
      const size = (validated ? 6 : 4.4) * s;

      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = `rgba(${colour}, ${rejected ? 0.5 : 0.95})`;
      ctx.fillStyle = `rgba(${colour}, ${validated ? 0.42 : 0.12})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.rect(-size, -size, size * 2, size * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (rejected) {
        ctx.strokeStyle = 'rgba(239, 106, 90, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x - 3.4, n.y - 3.4);
        ctx.lineTo(n.x + 3.4, n.y + 3.4);
        ctx.moveTo(n.x + 3.4, n.y - 3.4);
        ctx.lineTo(n.x - 3.4, n.y + 3.4);
        ctx.stroke();
      }

      if (n.score !== null && !rejected) {
        ctx.fillStyle = 'rgba(214, 230, 236, 0.66)';
        ctx.font = '8px ui-monospace, monospace';
        ctx.fillText(String(n.score), n.x, n.y + size + 10);
      }
    }

    if (this.#hover) {
      const n = this.#hover;
      const text = n.reason ? `${n.name} — ${n.reason}` : `${n.name}${n.score !== null ? ` · ${n.score}` : ''}`;
      const clipped = text.length > 84 ? `${text.slice(0, 81)}…` : text;
      ctx.font = '10px ui-monospace, monospace';
      const tw = ctx.measureText(clipped).width;
      const bx = Math.min(Math.max(n.x - tw / 2 - 7, 4), w - tw - 18);
      const by = Math.max(n.y - 30, 4);
      ctx.fillStyle = 'rgba(5, 10, 14, 0.95)';
      ctx.strokeStyle = 'rgba(94, 230, 220, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(bx, by, tw + 14, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d6e6ec';
      ctx.textAlign = 'left';
      ctx.fillText(clipped, bx + 7, by + 14);
      ctx.textAlign = 'center';
    }
  }
}
