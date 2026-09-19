import type { IntentName } from '../../../core/types/index.ts';

/**
 * How JARVIS addresses the operator.
 *
 * This layer touches register only. It never adds a figure, softens a refusal,
 * or dresses up a negative result: a reply that says nothing was found still
 * says nothing was found, and the master priority holds — truthfulness outranks
 * the way a sentence sounds. What it does is make the system sound like it
 * works for someone, because it does.
 */

/** What the operator is called. */
const ADDRESS = 'sir';

/*
 * Openers rotate so the system does not answer with the same word all day.
 * They are acknowledgements, never claims: each one says JARVIS heard the
 * order, and the sentence that follows carries the facts.
 */
const ACKS: Record<string, string[]> = {
  order: ['At once', 'Right away', 'Consider it done', 'On it'],
  steady: ['Very good', 'Understood', 'As you wish', 'Noted'],
  report: ['Here is where we stand', 'Current position', 'Standing report'],
};

/** A refusal or a limit is delivered straight: no opener softens a "no". */
const PLAIN: IntentName[] = ['UNKNOWN', 'SET_PERMISSION', 'AUTONOMOUS_MODE'];

/*
 * Sentences that report an obstacle rather than an action taken. "Consider it
 * done" in front of "I need a validated candidate first" is the system telling
 * the operator it did something it did not do, so these never get an
 * acknowledgement — they are addressed and delivered as they are.
 */
const OBSTACLE = /^(I need|I cannot|I can't|I did not|I could not|There is no|There are no|No mission|No storefront|Nothing |Permission levels)/i;

/** Attaches the form of address to the first sentence instead of opening with one. */
function addressFirstSentence(body: string): string {
  const end = /[.!?](\s|$)/.exec(body);
  if (!end) return `${body}, ${ADDRESS}.`;
  const cut = end.index;
  return `${body.slice(0, cut)}, ${ADDRESS}${body.slice(cut)}`;
}

function pick(bank: string[], seed: number): string {
  return bank[seed % bank.length] as string;
}

/** Rotates on a counter rather than at random, so a session does not repeat itself. */
let turn = 0;

export function inCharacter(intent: IntentName, speech: string): string {
  const body = speech.trim();
  if (!body) return body;
  turn += 1;

  // Anything already addressing the operator is left exactly as written.
  if (new RegExp(`\\b${ADDRESS}\\b`, 'i').test(body)) return body;

  // A sentence that already opens with an acknowledgement gets an address, not
  // a second acknowledgement stacked in front of the first.
  const existing = /^(Understood|Very good|Noted|Acknowledged|Right away|At once)\b[.,]?\s*/i.exec(body);
  if (existing) {
    const opener = (existing[1] as string).replace(/^./, (c) => c.toUpperCase());
    return `${opener}, ${ADDRESS}. ${body.slice(existing[0].length)}`.trim();
  }

  if (PLAIN.includes(intent)) return body;
  if (OBSTACLE.test(body)) return addressFirstSentence(body);

  if (intent === 'STATUS') {
    return `${pick(ACKS['report'] as string[], turn)}, ${ADDRESS}. ${body}`;
  }

  // View changes are answered in one breath; a long preamble defeats the point.
  if (intent === 'SHOW_DETAIL' || intent === 'HIDE_DETAIL' || intent === 'OPEN_INPUT') {
    return `${body.replace(/\.$/, '')}, ${ADDRESS}.`;
  }

  const bank = intent === 'STOP' || intent === 'PAUSE' || intent === 'RESUME' ? 'steady' : 'order';
  return `${pick(ACKS[bank] as string[], turn)}, ${ADDRESS}. ${body}`;
}
