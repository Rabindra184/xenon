export interface IHealingEvent {
  id: string;
  sessionId: string;
  deviceUdid: string | null;
  deviceName: string | null;
  devicePlatform: string | null;
  commandName: string | null;
  originalSelector: string | null;
  healedSelector: string | null;
  confidence: number | null;
  tier: string | null;
  isSuccess: boolean | null;
  createdAt: string;
}

export interface IHealingEventsResponse {
  events: IHealingEvent[];
  todayCount: number;
}

export type SelectorStateStatus = 'active' | 'pending' | 'resolved' | 'muted';

export interface ISelectorState {
  id?: string;
  original_strategy: string;
  original_selector: string;
  status: SelectorStateStatus;
  fixed_at: string | null;
  fixed_by_api_key: string | null;
  resolved_at: string | null;
  muted_at: string | null;
  muted_by_api_key: string | null;
  regression_count: number;
  clean_builds_count: number;
  last_event_at: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// Single muted-row shape returned by GET /healing/state/muted, with the
// "last time this selector healed" enrichment the backend adds.
export interface IMutedSelector {
  original_strategy: string;
  original_selector: string;
  muted_at: string | null;
  muted_by_api_key: string | null;
  last_healed_at: string | null;
  regression_count: number;
}

export interface IMutedSelectorsResponse {
  muted: IMutedSelector[];
  total: number;
  limit: number;
  offset: number;
}

export interface IHealingHotspot {
  // The strategy half of the (strategy, selector) tuple. Null for legacy
  // heals that happened before Smart Passive instrumentation.
  originalStrategy: string | null;
  originalSelector: string;
  healCount: number;
  sessionCount: number;
  suggestedRewrite: string | null;
  // Mode of healed_strategy across the bucket — null when no heal carried
  // a strategy (e.g. all OCR/visual results).
  suggestedStrategy: string | null;
  // Share of heals (0..1) that landed on the suggested rewrite. Useful for
  // surfacing how confident we are that the rewrite is the right answer.
  suggestedRewriteShare: number | null;
  topTier: string | null;
  averageConfidence: number | null;
  firstHealedAt: string;
  lastHealedAt: string;
  // Lifecycle state overlay — null when no SelectorState row exists
  // (implicitly Active).
  state?: ISelectorState | null;
}

export interface IHealingHotspotsResponse {
  windowDays: number;
  totalScanned: number;
  filters: { tier: string | null; platform: string | null; status?: string };
  hotspots: IHealingHotspot[];
}

export interface IHealingPeriodAggregate {
  totalHeals: number;
  distinctSelectors: number;
  sessionsTouched: number;
  byTier: Record<string, number>;
  estCostUsd: number;
}

export interface IHealingSummaryResponse {
  windowDays: number;
  current: IHealingPeriodAggregate;
  prior: IHealingPeriodAggregate;
  // Lifecycle counts (added with the trust-and-truth layer):
  // - resolvedCount: SelectorState rows in 'resolved' with resolved_at in window
  // - pendingCount:  SelectorState rows currently in 'pending' (no window — pending is a live state)
  resolvedCount?: number;
  pendingCount?: number;
}

export interface IHealingSelectorAlternate {
  healedSelector: string;
  count: number;
  share: number;
  averageConfidence: number | null;
  tiers: string[];
}

export interface IHealingSelectorTimelineEntry {
  id: string;
  sessionId: string;
  buildId: string | null;
  deviceUdid: string | null;
  deviceName: string | null;
  devicePlatform: string | null;
  commandName: string | null;
  healedSelector: string | null;
  confidence: number | null;
  tier: string | null;
  isSuccess: boolean | null;
  createdAt: string;
}

export interface IHealingSelectorDetail {
  originalSelector: string;
  windowDays: number;
  healCount: number;
  sessionCount: number;
  estCostUsd: number;
  byTier: Record<string, number>;
  byPlatform: Record<string, number>;
  byBuild: Array<{ buildId: string; count: number }>;
  alternates: IHealingSelectorAlternate[];
  timeline: IHealingSelectorTimelineEntry[];
}
