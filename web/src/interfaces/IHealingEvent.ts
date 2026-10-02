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

export interface IHealingPeriodAggregate {
  totalHeals: number;
  distinctSelectors: number;
  sessionsTouched: number;
  byTier: Record<string, number>;
  /** Total duration of the commands that needed healing. */
  timeSpentMs: number;
}

/** Heals in one day of the period, in the caller's time zone. */
export interface IHealingTrendDay {
  /** When the day began, epoch ms. */
  t: number;
  heals: number;
  /** Heals by Visual AI or an LLM. */
  aiHeals: number;
}

export interface IHealingSummaryResponse {
  windowDays: number;
  current: IHealingPeriodAggregate;
  prior: IHealingPeriodAggregate;
  resolvedCount?: number;
  pendingCount?: number;
  trend: IHealingTrendDay[];
}

export type SelectorTab = 'fix' | 'verifying' | 'fixed' | 'muted';
export type SelectorSort = 'heals' | 'recent' | 'time';

/** Who did something. `name` is null for someone the server no longer knows. */
export interface ISelectorPerson {
  id: string;
  name: string | null;
}

export interface ISelectorStateView {
  status: SelectorStateStatus;
  cleanBuilds: number;
  fixedAt: string | null;
  fixedBy: ISelectorPerson | null;
  resolvedAt: string | null;
  mutedAt: string | null;
  mutedBy: ISelectorPerson | null;
  muteReason: string | null;
  /** How often it healed again after being fixed. */
  brokeAgain: number;
}

export interface ISelectorListItem {
  /** '' for a heal recorded with no strategy. */
  strategy: string;
  selector: string;
  heals: number;
  sessions: number;
  lastHealedAt: string | null;
  timeSpentMs: number;
  topMethod: string | null;
  suggestion: { selector: string; strategy: string | null; share: number } | null;
  state: ISelectorStateView | null;
}

export interface ISelectorListResponse {
  tab: SelectorTab;
  days: number;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<SelectorTab, number>;
  canAct: boolean;
  items: ISelectorListItem[];
}

export type SelectorEventAction =
  | 'marked_fixed'
  | 'verification_cancelled'
  | 'verified'
  | 'broke_again'
  | 'muted'
  | 'unmuted';

export interface ISelectorSuggestion {
  selector: string;
  strategy: string | null;
  count: number;
  share: number;
  methods: string[];
  averageConfidence: number | null;
}

export interface ISelectorRecentHeal {
  id: string;
  sessionId: string;
  buildId: string | null;
  at: string;
  device: string | null;
  platform: string | null;
  method: string | null;
  confidence: number | null;
  healedSelector: string | null;
}

export interface ISelectorActivity {
  action: SelectorEventAction;
  at: string;
  by: ISelectorPerson | null;
  reason: string | null;
}

export interface ISelectorDetailResponse {
  strategy: string;
  selector: string;
  days: number;
  heals: number;
  sessions: number;
  timeSpentMs: number;
  firstHealedAt: string | null;
  lastHealedAt: string | null;
  daily: Array<{ t: number; heals: number }>;
  suggestions: ISelectorSuggestion[];
  platforms: Array<{ name: string; count: number }>;
  builds: Array<{ id: string | null; name: string; count: number }>;
  devices: Array<{ udid: string; name: string; count: number }>;
  recent: ISelectorRecentHeal[];
  state: ISelectorStateView | null;
  activity: ISelectorActivity[];
  canAct: boolean;
}
