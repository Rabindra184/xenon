export interface IBuild {
  id: string;
  name?: string | null;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
  passedCount: number;
  failedCount: number;
  runningCount: number;
}
