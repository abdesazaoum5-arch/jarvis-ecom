import type { IntentName } from '../types/index.ts';

/**
 * Intent recognition for natural speech, in English and Dutch.
 *
 * This is deliberately a transparent rule engine rather than a model call: the
 * control surface for "stop" must be instant, offline and never mis-fire, and
 * the operator can read exactly why an utterance was understood the way it was.
 */

export interface Interpretation {
  intent: IntentName;
  /** What JARVIS understood, phrased back to the operator. */
  objective: string;
  params: Record<string, string | number | boolean>;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** The phrase that decided it — shown when the operator asks "why". */
  matched: string | null;
}

interface Rule {
  intent: IntentName;
  /** Ordered: the first match wins, so interrupts sit at the top. */
  patterns: RegExp[];
  objective: (m: RegExpMatchArray, text: string) => string;
  params?: (m: RegExpMatchArray, text: string) => Record<string, string | number | boolean>;
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10,
};

/** Resolves "2" or "two"/"twee" to a number, for "why did you reject product two". */
function ordinal(text: string): number | null {
  const d = /\b(?:number|nummer|#)\s*(\d{1,3})\b/.exec(text) ?? /\bproduct\s*(\d{1,3})\b/i.exec(text);
  if (d?.[1]) return Number(d[1]);
  for (const [word, n] of Object.entries(NUM_WORDS)) {
    if (new RegExp(`\\b(?:number|nummer|product)\\s+${word}\\b`, 'i').test(text)) return n;
  }
  return null;
}

function count(text: string, fallback = 3): number {
  const digits = /\b(\d{1,3})\b/.exec(text);
  if (digits?.[1]) {
    const n = Number(digits[1]);
    if (n >= 1 && n <= 100) return n;
  }
  for (const [word, n] of Object.entries(NUM_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return n;
  }
  return fallback;
}

const RULES: Rule[] = [
  {
    intent: 'STOP',
    patterns: [/\b(stop|halt|abort|cancel|annuleer|stoppen|kappen)\b/i],
    objective: () => 'Stop all non-critical automation immediately.',
  },
  {
    intent: 'PAUSE',
    patterns: [/\b(pause|hold on|wait|pauzeer|pauze|wacht even)\b/i],
    objective: () => 'Pause the current mission and hold state.',
  },
  {
    intent: 'RESUME',
    patterns: [/\b(resume|continue|carry on|go on|ga door|hervat|doorgaan|verder)\b/i],
    objective: () => 'Resume the paused mission.',
  },
  {
    intent: 'AUTONOMOUS_MODE',
    patterns: [/\bautonomous mode\b/i, /\bfully autonomous\b/i, /\bautonome modus\b/i, /\bautonoom\b/i],
    objective: () => 'Run continuously within the granted permission level.',
  },
  {
    intent: 'SET_PERMISSION',
    patterns: [/\bpermission (?:level )?(\d)\b/i, /\blevel (\d)\b/i, /\bniveau (\d)\b/i, /\btoestemming(?:sniveau)? (\d)\b/i],
    objective: (m) => `Set the permission level to ${m[1]}.`,
    params: (m) => ({ level: Number(m[1] ?? 0) }),
  },
  {
    intent: 'STATUS',
    patterns: [/\b(status|what are you doing|wat doe je|voortgang|progress|where are you)\b/i],
    objective: () => 'Report current mission status.',
  },
  {
    intent: 'EXPLAIN',
    patterns: [
      /\bwhy (?:did you |have you )?(?:reject|rejected|kill|drop)(?:ed)?\b/i,
      /\bwaarom (?:heb je )?.{0,24}(?:afgewezen|verworpen)/i,
      /\bshow me why\b/i,
      /\bexplain\b/i,
      /\bleg uit\b/i,
      /\bwhy\b/i,
      /\bwaarom\b/i,
    ],
    objective: (_m, t) => {
      const i = ordinal(t);
      return i ? `Explain the decision on candidate ${i}.` : 'Explain the most recent decision.';
    },
    params: (_m, t): Record<string, string | number | boolean> => {
      const i = ordinal(t);
      return i ? { index: i } : {};
    },
  },
  {
    intent: 'BUILD_STORE',
    patterns: [/\b(build|create|maak|bouw).{0,20}\b(shopify|store|storefront|webshop|winkel)\b/i],
    objective: (_m, t) => `Build a Shopify-ready storefront${target(t) ? ` for ${target(t)}` : ''}.`,
    params: (_m, t): Record<string, string | number | boolean> => {
      const subject = target(t);
      return subject ? { subject } : {};
    },
  },
  {
    intent: 'BUILD_BRAND',
    patterns: [/\b(build|create|maak|bouw|ontwikkel).{0,20}\bbrand(ing)?\b/i, /\bmerk (?:op)?bouwen\b/i],
    objective: (_m, t) => `Create brand positioning and identity${target(t) ? ` for ${target(t)}` : ''}.`,
    params: (_m, t): Record<string, string | number | boolean> => {
      const subject = target(t);
      return subject ? { subject } : {};
    },
  },
  {
    intent: 'PREPARE_ADS',
    patterns: [/\b(prepare|build|create|maak|bereid).{0,20}\b(ads?|campaign|advertenties|campagne)\b/i, /\bad(vertising)? (setup|structure)\b/i],
    objective: (_m, t) => `Prepare advertising creatives and campaign structure${target(t) ? ` for ${target(t)}` : ''}.`,
    params: (_m, t): Record<string, string | number | boolean> => {
      const subject = target(t);
      return subject ? { subject } : {};
    },
  },
  {
    intent: 'OPTIMISE_STORE',
    patterns: [/\boptimi[sz]e\b.{0,20}\b(store|storefront|shop|page|conversion)\b/i, /\boptimaliseer\b/i],
    objective: () => 'Review the current storefront and propose conversion improvements.',
  },
  {
    intent: 'ANALYSE_RESULTS',
    patterns: [/\banal(y[sz]e|yse)\b.{0,25}\b(results?|performance|today|resultaten|prestaties)\b/i, /\bhow did .{0,20}(do|perform)\b/i],
    objective: () => 'Analyse performance data and report contribution profit.',
  },
  {
    intent: 'FIND_SUPPLIER',
    patterns: [/\b(find|get|zoek|vind).{0,25}\bsupplier|leverancier\b/i, /\bbetter supplier\b/i, /\bbetere leverancier\b/i],
    objective: (_m, t) => `Find and compare suppliers${target(t) ? ` for ${target(t)}` : ''}.`,
    params: (_m, t): Record<string, string | number | boolean> => {
      const subject = target(t);
      return subject ? { subject } : {};
    },
  },
  {
    intent: 'RESEARCH_PRODUCT',
    patterns: [/\b(research|investigate|onderzoek|analyseer)\b.{0,25}\b(this|that|dit|dat|the)? ?product\b/i, /\bdeep(er)? (dive|research)\b/i],
    objective: (_m, t) => `Research ${target(t) ?? 'the named product'} in depth.`,
    params: (_m, t): Record<string, string | number | boolean> => {
      const subject = target(t);
      return subject ? { subject } : {};
    },
  },
  {
    intent: 'DISCOVER_PRODUCTS',
    patterns: [
      /\b(find|discover|get|show|zoek|vind|geef)\b[^.]{0,40}\bproducts?\b/i,
      /\bproducten\b/i,
      /\b(?:new|different|another|other|fresh)\s+(?:\w+\s+){0,2}?niche\b/i,
      /\b(?:nieuwe|andere|ander)\s+(?:\w+\s+){0,2}?niche\b/i,
      /\bniche\b/i,
      /\bproduct (ideas|opportunities)\b/i,
    ],
    objective: (_m, t) => `Run a full discovery cycle and return only candidates that pass validation (target ${count(t)}).`,
    params: (_m, t) => ({ target: count(t), niche: nicheOf(t) ?? '' }),
  },
];

/** Pulls a quoted or trailing subject out of the utterance, if any. */
function target(text: string): string | null {
  const quoted = /["“']([^"”']{3,60})["”']/.exec(text);
  if (quoted?.[1]) return quoted[1].trim();
  const forPhrase = /\b(?:for|voor)\s+(?:the\s+)?([a-z0-9][\w\s-]{2,48})$/i.exec(text.trim());
  if (forPhrase?.[1]) return forPhrase[1].trim().replace(/[.?!]+$/, '');
  const numbered = /\bproduct\s*(?:number\s*|#\s*|nummer\s*)?(\d+)\b/i.exec(text);
  if (numbered?.[1]) return `candidate ${numbered[1]}`;
  return null;
}

function nicheOf(text: string): string | null {
  const m = /\b(?:in|within|binnen|in de)\s+(?:the\s+)?([a-z][\w\s-]{2,40}?)\s*(?:niche|market|categorie|category|space)\b/i.exec(text);
  return m?.[1]?.trim() ?? null;
}

export function interpret(utterance: string): Interpretation {
  const text = utterance.trim();
  if (!text) {
    return { intent: 'UNKNOWN', objective: 'Nothing to do.', params: {}, confidence: 'LOW', matched: null };
  }
  // "Jarvis, ..." is address, not content.
  const body = text.replace(/^\s*(hey\s+|ok\s+)?jarvis[,:]?\s*/i, '');
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const m = pattern.exec(body);
      if (m) {
        return {
          intent: rule.intent,
          objective: rule.objective(m, body),
          params: rule.params ? rule.params(m, body) : {},
          confidence: pattern.source.length > 24 ? 'HIGH' : 'MEDIUM',
          matched: m[0],
        };
      }
    }
  }
  return {
    intent: 'UNKNOWN',
    objective: `I did not recognise an objective in: "${body}".`,
    params: { raw: body },
    confidence: 'LOW',
    matched: null,
  };
}
