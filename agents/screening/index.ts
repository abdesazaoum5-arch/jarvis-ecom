import type { ProductCandidate } from '../../core/types/index.ts';

/**
 * Hard screening rules. These reject a candidate outright, before any research
 * budget is spent on it, and each rule states the gate it failed.
 */

export interface ScreenResult {
  pass: boolean;
  reason: string;
  reopenIf: string;
}

interface Rule {
  id: string;
  test: RegExp;
  reason: string;
  reopenIf: string;
}

/** Categories JARVIS will not build a business on. */
const PROHIBITED: Rule[] = [
  { id: 'counterfeit', test: /\b(replica|counterfeit|knock[- ]?off|fake (rolex|gucci|nike|airpods)|1:1 copy|dupe of)\b/i, reason: 'Counterfeit or replica goods — trademark infringement.', reopenIf: 'Never; this is an absolute exclusion.' },
  { id: 'trademark', test: /\b(disney|marvel|nike|adidas|apple|airpods|iron ?man|pokemon|lego)\b/i, reason: 'Trades on a third-party trademark.', reopenIf: 'An original product with no protected mark in the name.' },
  { id: 'medical', test: /\b(cure|cures|treats? (cancer|diabetes|covid)|medical grade|fda approved|clinically proven to cure|miracle)\b/i, reason: 'Depends on medical claims that cannot be substantiated.', reopenIf: 'A version sold on function alone, with no health claim.' },
  { id: 'regulated', test: /\b(cbd|thc|nicotine|vape|e-?cigarette|prescription|firearm|ammunition|taser|pepper spray)\b/i, reason: 'Heavily regulated category with advertising restrictions.', reopenIf: 'Explicit legal review and a compliant advertising route.' },
  { id: 'unsafe', test: /\b(laser pointer (5|[1-9]\d)00mw|lithium battery loose|airbag|child car seat|helmet)\b/i, reason: 'Safety-critical product: failure risks injury and carries strict liability.', reopenIf: 'Certified supplier with full conformity documentation and insurance.' },
  { id: 'fragile', test: /\b(glass (aquarium|terrarium)|crystal sculpture|porcelain vase|mirror wall)\b/i, reason: 'Breakage risk in parcel shipping makes the economics unworkable.', reopenIf: 'A supplier with proven protective packaging and a low measured breakage rate.' },
  { id: 'sizing', test: /\b(jeans|bra|fitted (shirt|dress)|shoes size|tailored suit)\b/i, reason: 'Complex sizing drives return rates that destroy contribution.', reopenIf: 'A one-size or adjustable variant.' },
  { id: 'perishable', test: /\b(fresh food|raw meat|live (plant|animal|fish)|refrigerated)\b/i, reason: 'Perishable goods need cold chain and cannot ship economically.', reopenIf: 'A shelf-stable version of the product.' },
];

/** Signals that a "product" is not a product at all. */
const NON_PRODUCT = /\b(course|ebook|webinar|service|consulting|subscription box idea|app|software|saas)\b/i;

export function screen(candidate: ProductCandidate): ScreenResult {
  const text = `${candidate.name} ${candidate.description ?? ''} ${candidate.category ?? ''}`;
  for (const rule of PROHIBITED) {
    if (rule.test.test(text)) return { pass: false, reason: rule.reason, reopenIf: rule.reopenIf };
  }
  if (NON_PRODUCT.test(candidate.name)) {
    return { pass: false, reason: 'Not a physical product that can be sourced and shipped.', reopenIf: 'A physical product built around the same demand.' };
  }
  if (candidate.name.trim().length < 3) {
    return { pass: false, reason: 'The candidate has no usable product name.', reopenIf: 'A specific named product.' };
  }
  if (!candidate.description || candidate.description.trim().length < 15) {
    return { pass: false, reason: 'No source explained what the product is or why it matters.', reopenIf: 'A source that describes the product and the need it serves.' };
  }
  return { pass: true, reason: 'Passed the hard exclusion rules.', reopenIf: '' };
}
