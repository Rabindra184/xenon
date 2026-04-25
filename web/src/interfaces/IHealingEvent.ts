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
  lastHealedAt: string;
}

export interface IHealingHotspotsResponse {
  windowDays: number;
  totalHeals: number;
  hotspots: IHealingHotspot[];
}
