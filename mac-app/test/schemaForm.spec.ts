import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildForm, parseJsonDraft } from '../src/renderer/src/schemaForm';
import { RETIRED_SETTINGS } from '../src/shared/retiredSettings';
import type { XenonSchema } from '../src/shared/types';

const schema = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'schema.json'), 'utf8')
) as XenonSchema;

describe('buildForm', () => {
  const sections = buildForm(schema);
  const allFields = sections.flatMap((s) => s.fields);

  it('covers every top-level schema property exactly once, except retired ones', () => {
    const keys = allFields.map((f) => f.key).sort();
    const propKeys = Object.keys(schema.properties)
      .filter((k) => !RETIRED_SETTINGS.has(k))
      .sort();
    expect(keys).toEqual(propKeys);
  });

  it('has no field for a retired setting, though the schema still lists it', () => {
    expect(schema.properties.databaseProvider).toBeDefined();
    expect(allFields.map((f) => f.key)).not.toContain('databaseProvider');
    expect(RETIRED_SETTINGS.has('databaseProvider')).toBe(true);
  });

  it('leaves a retired setting out of the Advanced sweep too', () => {
    const odd = { type: 'object', properties: { databaseProvider: { type: 'string' }, somethingNew: { type: 'string' } } };
    const keys = buildForm(odd as unknown as XenonSchema).flatMap((s) => s.fields.map((f) => f.key));
    expect(keys).toEqual(['somethingNew']);
  });

  it('maps types to the right control kinds', () => {
    const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
    expect(byKey.platform.kind).toBe('select'); // enum
    expect(byKey.enableDashboard.kind).toBe('toggle'); // boolean
    expect(byKey.maxSessions.kind).toBe('number'); // number
    expect(byKey.bindHostOrIp.kind).toBe('text'); // string
    expect(byKey.adbRemote.kind).toBe('stringList'); // array of string
  });

  it('flags secret-bearing settings so the form defers them to the Secrets panel', () => {
    const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
    expect(byKey.geminiApiKey.secret).toBe(true);
    expect(byKey.openaiApiKey.secret).toBe(true);
    expect(byKey.anthropicApiKey.secret).toBe(true);
    // Saved in the profile as plain text and never passed at launch, before it was a secret.
    expect(byKey.databaseUrl.secret).toBe(true);
  });

  it('resolves nested objects (autowait, interceptor) into sub-fields', () => {
    const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
    expect(byKey.autowait.kind).toBe('nested');
    expect(byKey.autowait.children?.some((c) => c.key === 'timeoutMs')).toBe(true);
    expect(byKey.interceptor.kind).toBe('nested');
    expect(byKey.interceptor.children?.some((c) => c.key === 'bufferSize')).toBe(true);
  });

  it('renders streaming.androidH264 (a boolean|object oneOf) as a toggle, not a text field', () => {
    const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
    expect(byKey.streaming.kind).toBe('nested');
    const androidH264 = byKey.streaming.children?.find((c) => c.key === 'androidH264');
    // Without oneOf→toggle handling it would fall through to a text field and the
    // user would store the string "true"/"false" instead of a real boolean.
    expect(androidH264?.kind).toBe('toggle');
  });

  it('casts proper nouns correctly in generated labels', () => {
    const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
    expect(byKey.iosDeviceType.label).toBe('iOS Device Type');
    expect(byKey.adbRemote.label).toBe('ADB Remote');
    expect(byKey.aiProvider.label).toBe('AI Provider');
    expect(byKey.aiBaseUrl.label).toBe('AI Base URL');
    expect(byKey.databaseUrl.label).toBe('Database URL');
    expect(byKey.tlsRejectUnauthorized.label).toBe('TLS Reject Unauthorized');
    expect(byKey.enableJsonLogging.label).toBe('Enable JSON Logging');
    expect(byKey.bindHostOrIp.label).toBe('Bind Host Or IP');
  });

  it('exposes item columns for object-array fields by resolving $ref items', () => {
    const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
    expect(byKey.simulators.itemColumns).toEqual(['name', 'sdk']);
    expect(byKey.emulators.itemColumns).toEqual(['avdName']);
  });

  it('marks required fields from the schema required[] list', () => {
    const form = buildForm({
      properties: { platform: { type: 'string' }, hub: { type: 'string' } },
      required: ['platform']
    } as unknown as XenonSchema);
    const byKey = Object.fromEntries(form.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(byKey.platform.required).toBe(true);
    expect(byKey.hub.required).toBe(false);
  });

  it('marks no field required on the real schema, where every arg has a default', () => {
    expect(allFields.filter((f) => f.required).map((f) => f.key)).toEqual([]);
  });
});

describe('parseJsonDraft', () => {
  it('treats empty / whitespace-only input as "unset"', () => {
    expect(parseJsonDraft('')).toEqual({ ok: true, value: undefined });
    expect(parseJsonDraft('   \n')).toEqual({ ok: true, value: undefined });
  });

  it('parses valid JSON', () => {
    expect(parseJsonDraft('[{"name":"iPhone 15","sdk":"17.0"}]')).toEqual({
      ok: true,
      value: [{ name: 'iPhone 15', sdk: '17.0' }]
    });
  });

  it('reports an error for invalid JSON instead of swallowing it', () => {
    const res = parseJsonDraft('[{"name": }]');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/JSON/i);
  });
});
