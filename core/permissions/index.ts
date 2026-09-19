import type { PermissionLevel, PermissionState } from '../types/index.ts';
import * as store from '../state/store.ts';
import { emit } from '../events/bus.ts';
import { nowIso } from '../util/id.ts';

/**
 * Permission gate. Default level is 0 (research only) and nothing inside the
 * system can raise it — `grant()` requires an explicit operator authorisation
 * string, and the server only calls it from an operator-initiated request.
 */

export const LEVELS: Record<PermissionLevel, string> = {
  0: 'Research only',
  1: 'Local file creation',
  2: 'Shopify draft modifications',
  3: 'Supplier communication drafts',
  4: 'Campaign preparation',
  5: 'Paid advertising launch',
  6: 'Financial transactions',
};

/** Capabilities mapped to the minimum level that may perform them. */
export const CAPABILITIES = {
  'research.web': 0,
  'research.browser': 0,
  'file.write': 1,
  'brand.generate': 1,
  'storefront.generate': 1,
  'creative.generate.local': 1,
  'shopify.draft': 2,
  'supplier.contact.draft': 3,
  'ads.prepare': 4,
  'ads.launch': 5,
  'payment.execute': 6,
  'purchase.any': 6,
} as const;

export type Capability = keyof typeof CAPABILITIES;

const DEFAULT: PermissionState = { level: 0, history: [], spendingAuthorised: false };

export async function current(): Promise<PermissionState> {
  const env = Number(process.env['JARVIS_PERMISSION_LEVEL'] ?? '0');
  const state = await store.read<PermissionState>('permissions', DEFAULT);
  // The environment variable can only ever be a floor of 0; it cannot raise the
  // level, so a stray env var in a deployment can never unlock spending.
  if (!Number.isFinite(env) || env !== 0) return state;
  return state;
}

export async function ensureInitialised(): Promise<PermissionState> {
  return store.update<PermissionState>('permissions', DEFAULT, (s) => s);
}

/**
 * Raised when the level is high enough but money has not been authorised.
 * Kept separate from PermissionDenied so the operator is told the real reason
 * rather than "needs level 6, current level is 6".
 */
export class SpendingNotAuthorised extends Error {
  readonly capability: Capability;
  constructor(capability: Capability) {
    super(
      `Blocked: "${capability}" would commit money. Permission level 6 is set, but spending has not been authorised. Authorise it explicitly to proceed — JARVIS will not do this on its own.`,
    );
    this.name = 'SpendingNotAuthorised';
    this.capability = capability;
  }
}

export class PermissionDenied extends Error {
  readonly capability: Capability;
  readonly required: PermissionLevel;
  readonly actual: PermissionLevel;
  constructor(capability: Capability, required: PermissionLevel, actual: PermissionLevel) {
    super(
      `Blocked: "${capability}" needs permission level ${required} (${LEVELS[required]}); current level is ${actual} (${LEVELS[actual]}). Raise it explicitly to proceed.`,
    );
    this.name = 'PermissionDenied';
    this.capability = capability;
    this.required = required;
    this.actual = actual;
  }
}

export async function allows(capability: Capability): Promise<boolean> {
  const { level } = await current();
  return level >= CAPABILITIES[capability];
}

/** Throws unless the operator has authorised this class of action. */
export async function require(capability: Capability): Promise<void> {
  const state = await current();
  const required = CAPABILITIES[capability] as PermissionLevel;
  if (state.level < required) {
    emit({
      kind: 'permission',
      level: 'warn',
      message: `Blocked ${capability}: needs level ${required}, operating at ${state.level}.`,
      data: { capability, required, actual: state.level },
    });
    throw new PermissionDenied(capability, required, state.level as PermissionLevel);
  }
  if (required >= 5 && state.spendingAuthorised === false) {
    emit({
      kind: 'permission',
      level: 'warn',
      message: `Blocked ${capability}: spending has not been authorised.`,
      data: { capability },
    });
    throw new SpendingNotAuthorised(capability);
  }
}

/**
 * Raise or lower the permission level. `authorisedBy` records who asked; the
 * orchestrator and agents never call this — only an operator-facing endpoint does.
 */
export async function grant(to: PermissionLevel, authorisedBy: string, note: string): Promise<PermissionState> {
  const next = await store.update<PermissionState>('permissions', DEFAULT, (s) => {
    const from = s.level;
    s.history.push({ at: nowIso(), from, to, authorisedBy, note });
    s.level = to;
    if (to < 6) s.spendingAuthorised = false;
    return s;
  });
  emit({
    kind: 'permission',
    message: `Permission level set to ${to} — ${LEVELS[to]}.`,
    data: { level: to, authorisedBy, note },
  });
  return next;
}

/** Separate, explicit switch for money. Level 6 alone is not enough. */
export async function authoriseSpending(note: string): Promise<PermissionState> {
  const next = await store.update<PermissionState>('permissions', DEFAULT, (s) => {
    if (s.level < 6) return s;
    s.spendingAuthorised = { at: nowIso(), note };
    return s;
  });
  emit({
    kind: 'permission',
    level: 'warn',
    message: next.spendingAuthorised ? 'Spending authorisation recorded.' : 'Spending authorisation refused: level 6 required first.',
    data: { note },
  });
  return next;
}
