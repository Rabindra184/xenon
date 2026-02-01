export interface IProfiling {
  id: number;
  session_id: string;
  cpu: string | null;
  memory: string | null;
  total_cpu_used: string | null;
  total_memory_used: string | null;
  raw_cpu_log: string | null;
  raw_memory_log: string | null;
  timestamp: string;
}
