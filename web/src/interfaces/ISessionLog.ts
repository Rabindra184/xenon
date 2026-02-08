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
  original_selector?: string | null;
  healed_selector?: string | null;
  healing_confidence?: number | null;
  trace_id?: string | null;
  span_id?: string | null;
  duration?: number | null;
  createdAt: string;
  updatedAt: string;
}
