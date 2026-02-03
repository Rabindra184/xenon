export interface ISession {
  id: string;
  build_id?: string | null;
  name?: string | null;
  status: string;
  desired_capabilities: string;
  session_capabilities: string;
  node_id: string;
  has_live_video: boolean;
  video_recording_enabled?: boolean;
  video_recording?: string | null;
  startTime: string;
  endTime?: string | null;
  failure_reason?: string | null;
  failure_category?: string | null;
  ai_analysis?: string | null;

  device_udid: string;
  device_platform: string;
  device_version: string;
  device_name?: string | null;
  performance_trace?: string | null;
  createdAt: string;
  updatedAt: string;
}
