import { useMemo } from 'react';
import type { XenonSchema, SettingsValues } from '@shared/types';
import { buildForm, type FormField } from '../schemaForm';
import { cn } from '../cn';

interface Props {
  schema: XenonSchema;
  values: SettingsValues;
  onChange: (key: string, value: unknown) => void;
}

function labelFor(field: FormField) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <label className="text-sm font-medium text-slate-800 dark:text-slate-200">
        {field.label}
        {field.required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      <code className="text-[11px] text-slate-400">{field.key}</code>
    </div>
  );
}

function Help({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">{text}</p>;
}

function FieldControl({
  field,
  value,
  onChange
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const effective = value ?? field.default;

  switch (field.kind) {
    case 'toggle':
      return (
        <button
          type="button"
          role="switch"
          aria-checked={!!effective}
          onClick={() => onChange(!effective)}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            effective ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-600'
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
              effective ? 'translate-x-5' : 'translate-x-1'
            )}
          />
        </button>
      );
    case 'number':
      return (
        <input
          type="number"
          value={effective === undefined || effective === null ? '' : String(effective)}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
      );
    case 'select':
      return (
        <select
          value={(effective as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="w-56 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">(default)</option>
          {field.enum?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'stringList': {
      const list = Array.isArray(effective) ? (effective as string[]) : [];
      return (
        <textarea
          value={list.join('\n')}
          placeholder="one entry per line"
          onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
          rows={Math.max(2, list.length + 1)}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-600 dark:bg-slate-800"
        />
      );
    }
    case 'json': {
      const text = effective === undefined ? '' : JSON.stringify(effective, null, 2);
      return (
        <textarea
          defaultValue={text}
          placeholder="JSON"
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (!raw) return onChange(undefined);
            try {
              onChange(JSON.parse(raw));
            } catch {
              /* keep last valid value; invalid JSON ignored on blur */
            }
          }}
          rows={4}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs dark:border-slate-600 dark:bg-slate-800"
        />
      );
    }
    case 'nested':
      return null; // rendered by the section, not inline
    default:
      return (
        <input
          type="text"
          value={(effective as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
      );
  }
}

export function SettingsForm({ schema, values, onChange }: Props) {
  const sections = useMemo(() => buildForm(schema), [schema]);

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.id}>
          <h3 className="mb-3 border-b border-slate-200 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700">
            {section.title}
          </h3>
          <div className="space-y-4">
            {section.fields.map((field) => {
              if (field.secret) {
                return (
                  <div key={field.key} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    <strong>{field.label}</strong> is a secret — set it in the <em>Secrets</em> tab (stored in the
                    Keychain, injected as an env var). Not written to the config file.
                  </div>
                );
              }
              if (field.kind === 'nested' && field.children) {
                const nestedVal = (values[field.key] as Record<string, unknown>) ?? {};
                return (
                  <div key={field.key} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    {labelFor(field)}
                    <Help text={field.description} />
                    <div className="mt-3 space-y-3 pl-3">
                      {field.children.map((child) => (
                        <div key={child.key}>
                          {labelFor(child)}
                          <FieldControl
                            field={child}
                            value={nestedVal[child.key]}
                            onChange={(v) => onChange(field.key, { ...nestedVal, [child.key]: v })}
                          />
                          <Help text={child.description} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <div key={field.key}>
                  {labelFor(field)}
                  <FieldControl field={field} value={values[field.key]} onChange={(v) => onChange(field.key, v)} />
                  <Help text={field.description} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
