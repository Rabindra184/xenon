/** A command a session ran: one row of GET /session/:id/session_log. */
export interface ISessionLog {
  id: string;
  session_id: string;
  command_name?: string | null;
  url: string;
  method: string;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  response: string;
  screenshot?: string | null;
  is_success?: boolean | null;
  is_error?: boolean;
  is_healed?: boolean;
  original_strategy?: string | null;
  original_selector?: string | null;
  healed_strategy?: string | null;
  healed_selector?: string | null;
  /** The tier that healed it, as a label ("Fuzzy XML"). */
  healing_tier?: string | null;
  /** 0 to 1. */
  healing_confidence?: number | null;
  trace_id?: string | null;
  span_id?: string | null;
  /** Milliseconds the command took; null when not measured. */
  duration?: number | null;
  /** When the row was written: as the command ended. */
  createdAt: string;
  updatedAt: string;
}
