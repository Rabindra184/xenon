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

export interface IHealingHotspot {
  originalSelector: string;
  healCount: number;
  sessionCount: number;
  suggestedRewrite: string | null;
  // Share of heals (0..1) that landed on the suggested rewrite. Useful for
  // surfacing how confident we are that the rewrite is the right answer.
  suggestedRewriteShare: number | null;
  topTier: string | null;
  averageConfidence: number | null;
  firstHealedAt: string;
  lastHealedAt: string;
}

export interface IHealingHotspotsResponse {
  windowDays: number;
  totalScanned: number;
  filters: { tier: string | null; platform: string | null };
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
