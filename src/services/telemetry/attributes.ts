// Single source of truth for OpenTelemetry attribute and metric instrument
// names emitted by Xenon. Instrumentation code must import from here — adding
// a free-form attribute key inline is a code-review red flag because:
//
//   1. Drift across modules silently breaks Grafana dashboards
//      (queries hard-code the keys).
//   2. High-cardinality values bound to attributes inflate Loki indexes.
//   3. Naming-convention mixing (snake vs. dot) makes filters inconsistent.
//
// New attributes use `dot.case`. The legacy `xenon.session_id` is kept
// snake-cased for back-compat with existing dashboards and PR #85.

export const ATTR = {
  // Session — pre-existing, do not rename.
  SESSION_ID: 'xenon.session_id',

  // Healing (consumed by upcoming PR for HealingOrchestrator instrumentation).
  HEALING_TIER: 'xenon.healing.tier',
  HEALING_ORIGINAL_STRATEGY: 'xenon.healing.original_strategy',
  HEALING_RESULT_STRATEGY: 'xenon.healing.result_strategy',
  HEALING_CONFIDENCE: 'xenon.healing.confidence',
  HEALING_DURATION_MS: 'xenon.healing.duration_ms',

  // Recording (consumed by upcoming PR for RecordingOrchestrator).
  RECORDING_GROUP_ID: 'xenon.recording.group_id',
  RECORDING_DEVICE_COUNT: 'xenon.recording.device_count',
  RECORDING_COMPOSITE_ENABLED: 'xenon.recording.composite_enabled',
  RECORDING_STATUS: 'xenon.recording.status',
  RECORDING_FAIL_REASON: 'xenon.recording.fail_reason',

  // MJPEG / iOS stream (consumed by upcoming PR).
  MJPEG_CLIENT_DROP_REASON: 'xenon.mjpeg.client_drop_reason',
} as const;

export const METRIC = {
  HEALING_ATTEMPTS: 'xenon.healing.attempts',
  HEALING_SUCCESSES: 'xenon.healing.successes',
  HEALING_FAILURES: 'xenon.healing.failures',
  HEALING_ALL_TIERS_FAILED: 'xenon.healing.all_tiers_failed',
  HEALING_TIER_SKIPPED: 'xenon.healing.tier_skipped',
  HEALING_DURATION_MS: 'xenon.healing.duration_ms',
  HEALING_CONFIDENCE: 'xenon.healing.confidence',

  RECORDING_ATTEMPTS: 'xenon.recording.attempts',
  RECORDING_FAILURES: 'xenon.recording.failures',
  RECORDING_COMPOSITE_FAILURES: 'xenon.recording.composite_failures',
  RECORDING_DURATION_MS: 'xenon.recording.duration_ms',
  RECORDING_DEVICE_COUNT: 'xenon.recording.device_count',

  MJPEG_CLIENTS_DROPPED: 'xenon.mjpeg.clients_dropped',
  MJPEG_UPSTREAM_RETRIES: 'xenon.mjpeg.upstream_retries',
  STREAM_IOS_TIME_TO_FIRST_FRAME_MS: 'xenon.stream.ios.time_to_first_frame_ms',
} as const;

// Outcome label values bound to metric attributes — kept narrow on purpose so
// that PromQL/LogQL queries can rely on exhaustive enums.
export const OUTCOME = {
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const;
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];

// Type aliases let call sites accept only known keys without the awkward
// `(typeof ATTR)[keyof typeof ATTR]` shape every time.
export type AttrKey = (typeof ATTR)[keyof typeof ATTR];
export type MetricKey = (typeof METRIC)[keyof typeof METRIC];
