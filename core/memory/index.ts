import type { Confidence, EvidencePoint } from '../types/index.ts';
import * as store from '../state/store.ts';
import { emit } from '../events/bus.ts';
import { newId, nowIso, slug } from '../util/id.ts';

/**
 * Long-term memory. Its job is to stop JARVIS relitigating settled questions:
 * a candidate rejected for a stated reason is not re-investigated unless new
 * evidence arrives that bears on that reason.
 */

export interface RejectionRecord {
  id: string;
  slug: string;
  name: string;
  reason: string;
  stage: string;
  agent: string;
  at: string;
  /** What would have to change for this to be worth looking at again. */
  reopenIf: string;
  evidenceIds: string[];
  timesSeen: number;
}

export interface LessonRecord {
  id: string;
  at: string;
  topic: 'hook' | 'angle' | 'offer' | 'creative' | 'campaign' | 'objection' | 'experiment' | 'supplier' | 'process';
  lesson: string;
  outcome: 'WORKED' | 'FAILED' | 'INCONCLUSIVE';
  confidence: Confidence;
  /** Ids of the campaigns/creatives/products this was learned from. */
  basis: string[];
}

export interface MemoryState {
  rejections: RejectionRecord[];
  lessons: LessonRecord[];
  /** slug -> last time a candidate was researched, to avoid duplicate work. */
  seen: Record<string, { name: string; lastSeenAt: string; count: number }>;
  suppliersKnown: Array<{ slug: string; name: string; marketplace: string; note: string; at: string }>;
  competitorsKnown: Array<{ slug: string; brand: string; url: string | null; note: string; at: string }>;
}

const EMPTY: MemoryState = { rejections: [], lessons: [], seen: {}, suppliersKnown: [], competitorsKnown: [] };

export async function load(): Promise<MemoryState> {
  return store.read<MemoryState>('memory', EMPTY);
}

export async function noteSeen(name: string): Promise<number> {
  const key = slug(name);
  const next = await store.update<MemoryState>('memory', EMPTY, (m) => {
    const prev = m.seen[key];
    m.seen[key] = { name, lastSeenAt: nowIso(), count: (prev?.count ?? 0) + 1 };
    return m;
  });
  return next.seen[key]?.count ?? 1;
}

export async function recordRejection(input: {
  name: string;
  reason: string;
  stage: string;
  agent: string;
  reopenIf: string;
  evidence?: EvidencePoint[];
}): Promise<void> {
  const key = slug(input.name);
  await store.update<MemoryState>('memory', EMPTY, (m) => {
    const existing = m.rejections.find((r) => r.slug === key);
    if (existing) {
      existing.timesSeen += 1;
      existing.at = nowIso();
      existing.reason = input.reason;
      return m;
    }
    m.rejections.push({
      id: newId('rej'),
      slug: key,
      name: input.name,
      reason: input.reason,
      stage: input.stage,
      agent: input.agent,
      at: nowIso(),
      reopenIf: input.reopenIf,
      evidenceIds: (input.evidence ?? []).map((e) => e.id),
      timesSeen: 1,
    });
    return m;
  });
}

/**
 * Was this already rejected? Returns the record so the caller can tell the
 * operator *why*, rather than silently dropping the candidate.
 */
export async function priorRejection(name: string): Promise<RejectionRecord | null> {
  const m = await load();
  return m.rejections.find((r) => r.slug === slug(name)) ?? null;
}

export async function recordLesson(input: Omit<LessonRecord, 'id' | 'at'>): Promise<LessonRecord> {
  const lesson: LessonRecord = { ...input, id: newId('les'), at: nowIso() };
  await store.update<MemoryState>('memory', EMPTY, (m) => {
    m.lessons.push(lesson);
    return m;
  });
  emit({ kind: 'system', agent: 'learning', message: `Lesson recorded: ${lesson.lesson}`, data: { topic: lesson.topic, outcome: lesson.outcome } });
  return lesson;
}

/** Lessons relevant to a topic, most recent first — fed into agent prompts. */
export async function lessonsFor(topic: LessonRecord['topic']): Promise<LessonRecord[]> {
  const m = await load();
  return m.lessons.filter((l) => l.topic === topic).sort((a, b) => b.at.localeCompare(a.at));
}
