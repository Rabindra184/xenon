// Shared types used by both the main process and the renderer. Keep this file
// free of any Node or Electron imports so it can be bundled into the renderer.

/** JSON-Schema (draft-07) subset we actually consume from schema.json. */
export interface JsonSchemaProperty {
  type?: string | string[];
  enum?: string[];
  oneOf?: JsonSchemaProperty[];
  default?: unknown;
  description?: string;
  title?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchemaProperty | { $ref?: string; type?: string };
  $ref?: string;
  properties?: Record<string, JsonSchemaProperty>;
  additionalProperties?: boolean | JsonSchemaProperty;
}

export interface XenonSchema {
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  definitions?: Record<string, JsonSchemaProperty>;
  title?: string;
  description?: string;
}

export interface SchemaMeta {
  pluginVersion: string;
  syncedFrom: string;
}

/** The set of plugin-arg values a profile carries. Keys mirror schema.json property names. */
export type SettingsValues = Record<string, unknown>;

/** A named, saved launch configuration. Never contains raw secret values. */
export interface Profile {
  id: string;
  name: string;
  /** Non-secret plugin-arg values (subset of schema.json properties). */
  settings: SettingsValues;
  /** Appium server-level knobs the launcher controls directly. */
  server: {
    port: number;
    basePath: string;
    /** APPIUM_HOME override; empty string means use the app-managed default. */
    appiumHome: string;
    /** Extra keep-alive timeout passed as `-ka`. */
    keepAliveTimeout: number;
  };
  /** Which secret keys this profile expects to inject (values live in SecretsStore). */
  secretRefs: SecretKey[];
  /** Extra non-secret environment variables (e.g. OTEL_*), injected at launch. */
  env: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

/** A single field validation problem surfaced in the UI and used to gate Start. */
export interface ValidationIssue {
  /** Setting key or a synthetic key like 'server.port'. */
  path: string;
  label: string;
  message: string;
}

/** Secret identifiers. Values are stored encrypted via Electron safeStorage, keyed by these. */
export type SecretKey =
  | 'XENON_GEMINI_API_KEY'
  | 'XENON_OPENAI_API_KEY'
  | 'XENON_ANTHROPIC_API_KEY'
  | 'XENON_HUB_ACCESS_KEY'
  | 'XENON_HUB_TOKEN'
  | 'DATABASE_URL'
  | 'XENON_SMTP_URL';

export interface SecretDescriptor {
  key: SecretKey;
  label: string;
  description: string;
}

/** Runtime state of the supervised Appium+Xenon process. */
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

export interface ServerState {
  status: ServerStatus;
  /** Active profile id when running/starting. */
  profileId: string | null;
  pid: number | null;
  port: number | null;
  /** Full dashboard URL once known, e.g. http://127.0.0.1:4723/xenon/. */
  dashboardUrl: string | null;
  startedAt: number | null;
  /** Absolute path to the per-run log file for this launch, when active. */
  logFile: string | null;
  /** Populated on crash/stop. */
  exitCode: number | null;
  exitSignal: string | null;
  lastError: string | null;
}

export interface LogLine {
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

/** Result of building a launch spec from a profile (also used for a dry-run preview). */
export interface LaunchSpec {
  command: string;
  args: string[];
  /** Env keys only — never the values (safe to show in a preview). */
  envKeys: string[];
  appiumHome: string;
  configYamlPath: string;
  configYaml: string;
}

export type ToolStatus = 'ok' | 'warn' | 'missing' | 'checking';

export interface ToolCheck {
  id: string;
  label: string;
  status: ToolStatus;
  /** Human-readable detail, e.g. detected version or the reason it failed. */
  detail: string;
  /** Whether a missing/warn result should block launching. */
  blocking: boolean;
  /** Actionable hint shown when not ok. */
  remediation?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: ToolCheck[];
  /** Non-toolchain blockers, e.g. "port 4723 in use", "plugin not installed". */
  blockers: string[];
}

export interface SetupProgress {
  step: string;
  done: boolean;
  ok: boolean;
  detail: string;
}

/** Actions the application menu dispatches to the renderer, which owns the state. */
export type MenuAction =
  | 'new-profile'
  | 'import-profiles'
  | 'export-profile'
  | 'toggle-server'
  | 'open-dashboard'
  | 'launch-preview'
  | 'tab-settings'
  | 'tab-secrets'
  | 'tab-health'
  | 'tab-logs';
