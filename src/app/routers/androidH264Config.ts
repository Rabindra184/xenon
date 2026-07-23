export type H264Source = 'scrcpy' | 'screenrecord';
export type AndroidH264Config = boolean | { source?: H264Source };

/**
 * Normalize the three accepted flag shapes to one:
 *   false | undefined        → { enabled:false }         (pure MJPEG — default)
 *   true                     → { enabled:true, scrcpy }  (new default source)
 *   { source }               → { enabled:true, source }  (explicit; scrcpy default)
 */
export function resolveAndroidH264(cfg: AndroidH264Config | undefined): {
  enabled: boolean;
  source: H264Source;
} {
  if (!cfg) return { enabled: false, source: 'scrcpy' };
  if (cfg === true) return { enabled: true, source: 'scrcpy' };
  return { enabled: true, source: cfg.source === 'screenrecord' ? 'screenrecord' : 'scrcpy' };
}
