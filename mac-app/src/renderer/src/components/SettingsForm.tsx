import { useEffect, useMemo, useState } from 'react';
import type { XenonSchema, SettingsValues } from '@shared/types';
import { buildForm, parseJsonDraft, type FormField } from '../schemaForm';
import { filterSections } from '../settingsFilter';
import { cn } from '../cn';
import { Segmented } from './ui/Segmented';
import { SettingsNav } from './SettingsNav';
import { Search } from 'lucide-react';

interface Props {
  schema: XenonSchema;
  values: SettingsValues;
  onChange: (key: string, value: unknown) => void;
  /** Validation messages keyed by setting key, shown inline under the field. */
  issues?: Record<string, string>;
}

function labelFor(field: FormField) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <label className="text-sm font-medium text-ink">
        {field.label}
        {field.required && <span className="ml-1 text-danger">*</span>}
      </label>
      <code className="text-[11px] text-dim">{field.key}</code>
    </div>
  );
}

function Help({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="mt-1 text-xs leading-snug text-muted">{text}</p>;
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
            'focus-ring relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            effective ? 'bg-accent' : 'bg-line-strong'
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 transform rounded-full bg-ink transition-transform',
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
          className="focus-ring w-48 rounded-md border border-line-strong bg-surface2 px-2 py-1 text-sm text-ink"
        />
      );
    case 'select':
      if (field.enum && field.enum.length <= 4) {
        return (
          <Segmented
            options={field.enum}
            value={effective as string | undefined}
            onChange={onChange}
            aria-label={field.label}
          />
        );
      }
      return (
        <select
          value={(effective as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="focus-ring w-56 rounded-md border border-line-strong bg-surface2 px-2 py-1 text-sm text-ink"
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
          className="focus-ring w-full rounded-md border border-line-strong bg-surface2 px-2 py-1 font-mono text-xs text-ink"
        />
      );
    }
    case 'json':
      return <JsonField value={effective} onChange={onChange} />;
    case 'nested':
      return null; // rendered by the section, not inline
    default:
      return (
        <input
          type="text"
          value={(effective as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="focus-ring w-full rounded-md border border-line-strong bg-surface2 px-2 py-1 text-sm text-ink"
        />
      );
  }
}

/**
 * JSON editor with an explicit invalid state: the draft text is kept (never
 * silently discarded) and a parse error is shown until the user fixes it.
 * Commits on blur; empty text unsets the value.
 */
function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const committed = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(committed);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Follow external value changes (e.g. profile switch) unless the user is mid-edit.
  useEffect(() => {
    if (!dirty) setText(committed);
  }, [committed, dirty]);

  const commit = () => {
    const res = parseJsonDraft(text);
    if (res.ok) {
      setError(null);
      setDirty(false);
      onChange(res.value);
    } else {
      setError(res.error);
    }
  };

  return (
    <>
      <textarea
        value={text}
        placeholder="JSON"
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onBlur={commit}
        rows={4}
        aria-invalid={!!error}
        className={cn(
          'focus-ring w-full rounded-md border bg-surface2 px-2 py-1 font-mono text-xs text-ink',
          error ? 'border-danger/60' : 'border-line-strong'
        )}
      />
      <ErrorText msg={error ?? undefined} />
    </>
  );
}

function ErrorText({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs font-medium text-danger">{msg}</p>;
}

export function SettingsForm({ schema, values, onChange, issues = {} }: Props) {
  const allSections = useMemo(() => buildForm(schema), [schema]);
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const searching = query.trim().length > 0;
  const sections = useMemo(() => filterSections(allSections, query), [allSections, query]);

  // Scroll-spy: highlight the section nearest the top of the scroll area.
  useEffect(() => {
    if (searching) return;
    const els = sections
      .map((s) => document.getElementById(`settings-${s.id}`))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const first = entries.find((e) => e.isIntersecting);
        if (first) setActiveSection(first.target.id.replace('settings-', ''));
      },
      { rootMargin: '0px 0px -70% 0px' }
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [sections, searching]);

  const jump = (id: string) =>
    document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  return (
    <div className="flex gap-6">
      {!searching && (
        <div className="sticky top-0 hidden w-40 shrink-0 self-start lg:block">
          <SettingsNav sections={sections} activeId={activeSection} onJump={jump} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="relative mb-5">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2 text-dim" />
          <input
            data-testid="settings-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="focus-ring w-full rounded-md border border-line-strong bg-surface2 py-1.5 pl-8 pr-2 text-sm text-ink placeholder:text-dim"
          />
        </div>
        {sections.length === 0 ? (
          <p className="text-sm text-muted">No settings match ‘{query.trim()}’.</p>
        ) : (
          <SectionList sections={sections} values={values} onChange={onChange} issues={issues} />
        )}
      </div>
    </div>
  );
}

function SectionList({
  sections,
  values,
  onChange,
  issues
}: {
  sections: ReturnType<typeof buildForm>;
  values: SettingsValues;
  onChange: (key: string, value: unknown) => void;
  issues: Record<string, string>;
}) {
  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.id} id={`settings-${section.id}`} className="scroll-mt-4">
          <h3 className="mb-3 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {section.title}
          </h3>
          <div className="space-y-4">
            {section.fields.map((field) => {
              if (field.secret) {
                return (
                  <div key={field.key} className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                    <strong>{field.label}</strong> is a secret — set it in the <em>Secrets</em> tab (stored in the
                    Keychain, injected as an env var). Not written to the config file.
                  </div>
                );
              }
              if (field.kind === 'nested' && field.children) {
                const nestedVal = (values[field.key] as Record<string, unknown>) ?? {};
                return (
                  <div key={field.key} className="rounded-md border border-line p-3">
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
                  <ErrorText msg={issues[field.key]} />
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
