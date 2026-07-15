import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildForm } from '../src/renderer/src/schemaForm';
import type { XenonSchema } from '../src/shared/types';

const schema = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'schema.json'), 'utf8')
) as XenonSchema;

describe('buildForm', () => {
  const sections = buildForm(schema);
  const allFields = sections.flatMap((s) => s.fields);

  it('covers every top-level schema property exactly once', () => {
    const keys = allFields.map((f) => f.key).sort();
    const propKeys = Object.keys(schema.properties).sort();
    expect(keys).toEqual(propKeys);
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
  });

  it('resolves nested objects (autowait, interceptor) into sub-fields', () => {
    const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
    expect(byKey.autowait.kind).toBe('nested');
    expect(byKey.autowait.children?.some((c) => c.key === 'timeoutMs')).toBe(true);
    expect(byKey.interceptor.kind).toBe('nested');
    expect(byKey.interceptor.children?.some((c) => c.key === 'bufferSize')).toBe(true);
  });

  it('marks required fields from the schema required[] list', () => {
    const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
    expect(byKey.platform.required).toBe(true);
    expect(byKey.hub.required).toBe(false);
  });
});
