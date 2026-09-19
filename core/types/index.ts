/**
 * JARVIS ECOM — shared domain types.
 *
 * Truthfulness rules encoded in the type system:
 *  - Every quantitative claim about the outside world is a {@link Evidenced} value
 *    carrying its provenance ({@link Provenance}) and confidence.
 *  - Anything JARVIS could not verify is `null` with provenance `UNKNOWN`.
 *    There is no code path that substitutes a plausible number for a missing one.
 */

/** How a value came to be known. Never widen this without a truthfulness review. */
export type Provenance =
  /** Directly observed by JARVIS in a retrieved document (URL + timestamp recorded). */
  | 'FACT'
  /** A claim made by a source; true only insofar as the source is reliable. */
  | 'SOURCE_CLAIM'
  /** Derived by JARVIS from FACT/SOURCE_CLAIM values via a stated rule. */
  | 'INFERENCE'
  /** A modelling input chosen by JARVIS or the operator. Must state the rationale. */
  | 'ASSUMPTION'
  /** Not established. The value is null. */
  | 'UNKNOWN';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SourceRef {
  url: string;
  title: string | null;
  /** ISO-8601 time the source was retrieved. */
  retrievedAt: string;
  /** Which adapter retrieved it, e.g. "claude-bridge", "browser", "http". */
  via: string;
  /** Verbatim excerpt supporting the claim, if captured. */
  excerpt: string | null;
}

/** A value plus the reason JARVIS believes it. `value === null` means UNKNOWN. */
export interface Evidenced<T> {
  value: T | null;
  provenance: Provenance;
  confidence: Confidence;
  /** Stated rule for INFERENCE, stated rationale for ASSUMPTION. */
  basis: string | null;
  sources: SourceRef[];
}

export interface EvidencePoint {
  id: string;
  /** What this evidence establishes, in one sentence. */
  claim: string;
  provenance: Provenance;
  confidence: Confidence;
  source: SourceRef | null;
  /** Which agent recorded it. */
  agent: string;
  recordedAt: string;
  /** Does it support or contradict the candidate? */
  polarity: 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

/** 0 research only … 6 financial transactions. Only the operator raises this. */
export type PermissionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface PermissionState {
  level: PermissionLevel;
  /** Audit trail of every change, including who authorised it. */
  history: Array<{
    at: string;
    from: PermissionLevel;
    to: PermissionLevel;
    authorisedBy: string;
    note: string;
  }>;
  /** Hard ceiling that the running system can never exceed on its own. */
  spendingAuthorised: false | { at: string; note: string };
}

/* ------------------------------------------------------------------ */
/* Missions                                                            */
/* ------------------------------------------------------------------ */

export type MissionStatus =
  | 'IDLE'
  | 'INTERPRETING'
  | 'RESEARCHING'
  | 'VALIDATING'
  | 'BUILDING'
  | 'PAUSED'
  | 'STOPPED'
  | 'COMPLETE'
  | 'FAILED';

export type StageId =
  | 'interpret'
  | 'discover'
  | 'deduplicate'
  | 'screen'
  | 'demand'
  | 'trend'
  | 'competition'
  | 'customer'
  | 'supplier'
  | 'economics'
  | 'compliance'
  | 'score'
  | 'deep-research'
  | 'finalise';

export interface StageState {
  id: StageId;
  label: string;
  status: 'PENDING' | 'ACTIVE' | 'DONE' | 'SKIPPED' | 'FAILED';
  startedAt: string | null;
  finishedAt: string | null;
  /** Candidates entering and leaving this stage — the real funnel, never padded. */
  inCount: number | null;
  outCount: number | null;
  note: string | null;
}

export interface Mission {
  id: string;
  /** The operator's own words. */
  utterance: string;
  /** JARVIS's reading of the objective. */
  objective: string;
  intent: IntentName;
  params: Record<string, string | number | boolean>;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  stages: StageState[];
  activeAgents: string[];
  sourcesConsulted: number;
  progress: number;
  /** Set when the operator interrupts. Agents poll this between units of work. */
  control: 'RUN' | 'PAUSE' | 'STOP';
  failure: string | null;
}

export type IntentName =
  | 'DISCOVER_PRODUCTS'
  | 'RESEARCH_PRODUCT'
  | 'FIND_SUPPLIER'
  | 'BUILD_BRAND'
  | 'BUILD_STORE'
  | 'PREPARE_ADS'
  | 'OPTIMISE_STORE'
  | 'ANALYSE_RESULTS'
  | 'EXPLAIN'
  | 'STATUS'
  | 'STOP'
  | 'PAUSE'
  | 'RESUME'
  | 'AUTONOMOUS_MODE'
  | 'SET_PERMISSION'
  | 'UNKNOWN';

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export type CandidateStage =
  | 'DISCOVERED'
  | 'INVESTIGATING'
  | 'VALIDATED'
  | 'REJECTED';

export type LifecycleStatus =
  | 'RESEARCHING'
  | 'VALIDATING'
  | 'PROMISING'
  | 'READY'
  | 'SCALING'
  | 'DECLINING'
  | 'KILLED';

export interface ScoreComponent {
  key: ScoreKey;
  label: string;
  weight: number;
  /** 0-100 for this component, or null when there is not enough evidence. */
  raw: number | null;
  /** Why this number. Required — an unexplained score is a bug. */
  rationale: string;
  evidenceIds: string[];
}

export type ScoreKey =
  | 'demandEvidence'
  | 'problemStrength'
  | 'creativePotential'
  | 'marginPotential'
  | 'competition'
  | 'brandability'
  | 'logistics'
  | 'supplierAvailability'
  | 'repeatPurchase'
  | 'complianceRisk';

export interface ProductScore {
  /** Weighted 0-100 over the components that had evidence. */
  total: number | null;
  /** Share of total weight that had evidence behind it. Drives confidence. */
  coverage: number;
  confidence: Confidence;
  components: ScoreComponent[];
  computedAt: string;
}

export interface ProductCandidate {
  id: string;
  missionId: string;
  name: string;
  category: string | null;
  description: string | null;
  stage: CandidateStage;
  lifecycle: LifecycleStatus;
  discoveredAt: string;
  updatedAt: string;
  discoveredVia: string[];
  /** Populated only by agents that actually ran. */
  demand: DemandProfile | null;
  trend: TrendProfile | null;
  competition: CompetitionProfile | null;
  customer: CustomerProfile | null;
  suppliers: SupplierOption[];
  economics: UnitEconomics | null;
  compliance: ComplianceProfile | null;
  brand: BrandProfile | null;
  score: ProductScore | null;
  evidence: EvidencePoint[];
  /** Set when the candidate leaves the funnel. Always names the failing gate. */
  rejection: { at: string; stage: StageId; reason: string; agent: string } | null;
  risks: string[];
  marketingAngles: string[];
}

export interface DemandProfile {
  signals: Array<{
    label: string;
    detail: Evidenced<string>;
  }>;
  summary: Evidenced<string>;
}

export interface TrendProfile {
  /** Direction over the observed window, never a forecast. */
  momentum: Evidenced<'RISING' | 'FLAT' | 'DECLINING'>;
  observedWindow: string | null;
  seasonality: Evidenced<string>;
  futureSignals: Array<{ signal: string; reading: Evidenced<string> }>;
}

export interface CompetitorRecord {
  id: string;
  brand: string;
  url: string | null;
  price: Evidenced<number>;
  currency: string | null;
  positioning: Evidenced<string>;
  headline: Evidenced<string>;
  benefits: string[];
  reviewSignal: Evidenced<string>;
  complaints: string[];
  guarantee: Evidenced<string>;
  shipping: Evidenced<string>;
  bundles: Evidenced<string>;
  upsells: Evidenced<string>;
  creativeStyle: Evidenced<string>;
  adAngles: string[];
  weaknesses: string[];
}

export interface CompetitionProfile {
  competitors: CompetitorRecord[];
  saturation: Evidenced<'LOW' | 'MODERATE' | 'HIGH'>;
  /** Unmet needs JARVIS found — the basis for differentiation, not imitation. */
  gaps: string[];
}

export interface CustomerProfile {
  segment: Evidenced<string>;
  desires: string[];
  problems: string[];
  objections: string[];
  complaintThemes: string[];
}

export interface SupplierOption {
  id: string;
  marketplace: string;
  supplierName: Evidenced<string>;
  url: string | null;
  unitPrice: Evidenced<number>;
  currency: string | null;
  shippingCost: Evidenced<number>;
  deliveryDays: Evidenced<string>;
  tracking: Evidenced<boolean>;
  reviewSignal: Evidenced<string>;
  moq: Evidenced<number>;
  warehouses: string[];
  brandingSupport: Evidenced<boolean>;
  returnHandling: Evidenced<string>;
  complianceDocs: Evidenced<string>;
  reliabilityNotes: string[];
}

export interface EconomicsScenario {
  label: 'BASE' | 'BEST' | 'WORST';
  sellingPrice: number;
  aov: number;
  productCost: number;
  shippingCost: number;
  paymentFees: number;
  platformFees: number;
  refundCost: number;
  supportCost: number;
  contributionBeforeAds: number;
  breakEvenCpa: number;
  breakEvenRoas: number;
  assumedAdCost: number | null;
  contributionAfterAds: number | null;
}

export interface UnitEconomics {
  currency: string;
  /** Inputs that were measured vs. assumed — surfaced in the UI. */
  inputs: Record<string, Evidenced<number>>;
  scenarios: EconomicsScenario[];
  /** True only when every cost input is FACT or SOURCE_CLAIM. */
  fullyGrounded: boolean;
  notes: string[];
}

export interface ComplianceProfile {
  jurisdiction: string;
  checks: Array<{
    area: string;
    finding: Evidenced<string>;
    status: 'OK' | 'ATTENTION' | 'HUMAN_REVIEW_REQUIRED' | 'UNKNOWN';
  }>;
  humanReviewRequired: boolean;
}

export interface BrandProfile {
  name: string;
  rationale: string;
  positioning: string;
  audience: string;
  tone: string[];
  typography: { display: string; body: string; rationale: string };
  palette: Array<{ name: string; hex: string; use: string }>;
  packaging: string;
  productNaming: string[];
  slogan: string;
  story: string;
  photographyDirection: string;
  videoDirection: string;
}

/* ------------------------------------------------------------------ */
/* Offers, storefront, creatives, campaigns                            */
/* ------------------------------------------------------------------ */

export interface Offer {
  tier: 'STARTER' | 'BEST_VALUE' | 'COMPLETE_SYSTEM';
  name: string;
  contents: string[];
  price: number;
  currency: string;
  /** Contribution at this price using the product's grounded economics. */
  contribution: number;
  rationale: string;
}

export interface StorefrontPage {
  slug: string;
  title: string;
  /** Markdown body. Written from researched claims only. */
  body: string;
  /** Claims in this page that need human/legal sign-off before publishing. */
  flags: string[];
}

export interface Storefront {
  productId: string;
  pages: StorefrontPage[];
  productPageSections: Array<{ section: string; copy: string }>;
  generatedAt: string;
}

export type CreativeFormat = 'VIDEO' | 'STATIC' | 'CAROUSEL';

export interface CreativeConcept {
  id: string;
  productId: string;
  format: CreativeFormat;
  angle: string;
  hook: string;
  script: string | null;
  shotList: string[];
  cameraDirections: string[];
  voiceover: string | null;
  overlays: string[];
  editingNotes: string[];
  /** Set when a generation backend actually produced a file. */
  renderedAsset: { path: string; provider: string; at: string } | null;
  truthfulnessNotes: string[];
}

export interface CampaignPlan {
  productId: string;
  objective: 'SALES';
  optimisation: 'PURCHASE';
  adSets: Array<{
    name: string;
    audienceNote: string;
    dailyBudgetSuggestion: number | null;
    ads: Array<{ creativeId: string; primaryText: string; headline: string }>;
  }>;
  /** Nothing here is live. Launch requires level 5 and an explicit instruction. */
  status: 'PREPARED';
  preLaunchChecklist: string[];
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export type EventKind =
  | 'system'
  | 'mission'
  | 'agent'
  | 'action'
  | 'discovery'
  | 'rejection'
  | 'evidence'
  | 'economics'
  | 'permission'
  | 'error'
  | 'adapter';

export interface JarvisEvent {
  id: string;
  at: string;
  kind: EventKind;
  /** Human-readable, present tense: what the operator sees in the timeline. */
  message: string;
  agent: string | null;
  missionId: string | null;
  /** Live-research telemetry so the operator can watch the work. */
  target: { site: string | null; url: string | null; action: string | null } | null;
  data: Record<string, unknown> | null;
  level: 'info' | 'warn' | 'error';
}

/* ------------------------------------------------------------------ */
/* Adapters                                                            */
/* ------------------------------------------------------------------ */

export type AdapterStatus = 'CONNECTED' | 'NOT_CONNECTED' | 'DEGRADED' | 'UNKNOWN';

export interface AdapterReport {
  id: string;
  kind: 'research' | 'browser' | 'commerce' | 'ads' | 'creative' | 'voice' | 'llm';
  status: AdapterStatus;
  /** Exactly why — shown verbatim in the UI so nothing looks connected that isn't. */
  detail: string;
  /** What the operator would have to do to connect it. */
  remedy: string | null;
  checkedAt: string;
  free: boolean | null;
}
