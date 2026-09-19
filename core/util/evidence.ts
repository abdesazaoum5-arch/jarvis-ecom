import type { Confidence, Evidenced, EvidencePoint, Provenance, SourceRef } from '../types/index.ts';
import { newId, nowIso } from './id.ts';

/**
 * The only supported way to produce an Evidenced value.
 * There is deliberately no helper that invents a value without provenance.
 */
export function evidenced<T>(
  value: T | null,
  provenance: Provenance,
  opts: { confidence?: Confidence; basis?: string | null; sources?: SourceRef[] } = {},
): Evidenced<T> {
  if (value === null && provenance !== 'UNKNOWN') {
    // A null value is by definition unknown; silently mislabelling it would let
    // "we measured nothing" render as "we measured something".
    provenance = 'UNKNOWN';
  }
  return {
    value,
    provenance,
    confidence: opts.confidence ?? defaultConfidence(provenance),
    basis: opts.basis ?? null,
    sources: opts.sources ?? [],
  };
}

/** The explicit representation of "JARVIS could not establish this". */
export function unknown<T>(reason: string): Evidenced<T> {
  return { value: null, provenance: 'UNKNOWN', confidence: 'LOW', basis: reason, sources: [] };
}

function defaultConfidence(p: Provenance): Confidence {
  switch (p) {
    case 'FACT':
      return 'HIGH';
    case 'SOURCE_CLAIM':
      return 'MEDIUM';
    case 'INFERENCE':
      return 'MEDIUM';
    case 'ASSUMPTION':
      return 'LOW';
    default:
      return 'LOW';
  }
}

export function isKnown<T>(e: Evidenced<T> | null | undefined): e is Evidenced<T> & { value: T } {
  return !!e && e.value !== null && e.provenance !== 'UNKNOWN';
}

export function evidencePoint(input: {
  claim: string;
  provenance: Provenance;
  agent: string;
  source?: SourceRef | null;
  confidence?: Confidence;
  polarity?: EvidencePoint['polarity'];
}): EvidencePoint {
  return {
    id: newId('ev'),
    claim: input.claim,
    provenance: input.provenance,
    confidence: input.confidence ?? defaultConfidence(input.provenance),
    source: input.source ?? null,
    agent: input.agent,
    recordedAt: nowIso(),
    polarity: input.polarity ?? 'SUPPORTS',
  };
}

/**
 * Confidence for a conclusion built on several evidence points.
 * Independent, first-hand, non-contradicted evidence raises it; little or
 * conflicting evidence lowers it. Never returns HIGH on inference alone.
 */
export function aggregateConfidence(points: EvidencePoint[]): Confidence {
  const supporting = points.filter((p) => p.polarity === 'SUPPORTS');
  const contradicting = points.filter((p) => p.polarity === 'CONTRADICTS');
  const firstHand = supporting.filter((p) => p.provenance === 'FACT' || p.provenance === 'SOURCE_CLAIM');
  const distinctHosts = new Set(
    firstHand.map((p) => {
      try {
        return p.source ? new URL(p.source.url).hostname : 'none';
      } catch {
        return 'none';
      }
    }),
  );
  distinctHosts.delete('none');
  if (contradicting.length >= supporting.length) return 'LOW';
  if (firstHand.length >= 6 && distinctHosts.size >= 4) return 'HIGH';
  if (firstHand.length >= 3 && distinctHosts.size >= 2) return 'MEDIUM';
  return 'LOW';
}
