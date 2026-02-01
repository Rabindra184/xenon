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
  createdAt: string;
  updatedAt: string;
}
