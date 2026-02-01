export interface ILog {
  id: string;
  session_id: string;
  log_type: 'DEVICE' | 'DEBUG';
  message: string;
  timestamp: string;
  createdAt: string;
  updatedAt: string;
}
