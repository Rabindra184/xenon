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
