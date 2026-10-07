import { useEffect, useMemo, useState } from 'react';
import type { EffectiveSchemaInfo, XenonSchema, SettingsValues } from '@shared/types';
import { buildForm, type FormField } from '../schemaForm';
import { columnsFor } from '../editorModel';
import { filterSections } from '../settingsFilter';
import { schemaSourceLine } from '../schemaSource';
import { Segmented } from './ui/Segmented';
import { Switch } from './ui/Switch';
import { ChipListEditor } from './ui/ChipListEditor';
import { ObjectTableEditor } from './ui/ObjectTableEditor';
import { JsonField } from './ui/JsonField';
import { SettingsNav } from './SettingsNav';
import { KeyRound, Search } from 'lucide-react';

interface Props {
  schema: XenonSchema;
  /** Where `schema` came from; shown as a muted line above the search box. */
  schemaInfo?: EffectiveSchemaInfo | null;
  values: SettingsValues;
  onChange: (key: string, value: unknown) => void;
  /** Validation messages keyed by setting key, shown inline under the field. */
  issues?: Record<string, string>;
}

/** The name above a control. `htmlFor` ties it to the control's id, so the control is announced with it. */
function labelFor(field: FormField, htmlFor?: string) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {field.label}
        {field.required && <span className="ml-1 text-danger">*</span>}
      </label>
      <code className="text-2xs text-dim">{field.key}</code>
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
  onChange,
  id
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  /** The id the field's <label> points at (the box kinds only). */
  id: string;
}) {
  const effective = value ?? field.default;

  switch (field.kind) {
    case 'toggle':
      return null; // rendered by FieldRow: a Switch brings its own name
    case 'number':
      return (
        <input
          id={id}
          type="number"
          value={effective === undefined || effective === null ? '' : String(effective)}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="focus-ring w-48 rounded-md border border-dim bg-surface2 px-2 py-1 text-sm text-ink"
        />
      );
    case 'select':
      if (field.enum && field.enum.length <= 4) {
        return (
          <Segmented
            options={field.enum}
            value={effective as string | undefined}
            // Unset means the schema default: clicking the chosen option goes back to it.
            clearable
            onChange={onChange}
            aria-label={field.label}
          />
        );
      }
      return (
        <select
          id={id}
          value={(effective as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="focus-ring w-56 rounded-md border border-dim bg-surface2 px-2 py-1 text-sm text-ink"
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
      return <ChipListEditor value={list} onChange={onChange} />;
    }
    case 'json': {
      const cols = columnsFor(field);
      if (!cols) return <JsonField value={effective} onChange={onChange} />;
      const rows = Array.isArray(effective) ? (effective as Array<Record<string, string>>) : [];
      return <ObjectTableEditor columns={cols} value={rows} onChange={onChange} />;
    }
    case 'nested':
      return null; // rendered by the section, not inline
    default:
      return (
        <input
          id={id}
          type="text"
          value={(effective as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="focus-ring w-full rounded-md border border-dim bg-surface2 px-2 py-1 text-sm text-ink"
        />
      );
  }
}

/** One setting: its name, its control, its problem (if any) and its help. */
function FieldRow({
  field,
  settingKey,
  value,
  onChange,
  error
}: {
  field: FormField;
  /** The wrapper's data-setting-key: the field's key, or `parent.child` when nested. */
  settingKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const id = `setting-${settingKey}`;

  if (field.kind === 'toggle') {
    return (
      <div data-setting-key={settingKey}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Switch
              id={id}
              label={field.label}
              description={field.description}
              checked={!!(value ?? field.default)}
              onCheckedChange={onChange}
            />
          </div>
          <code className="mt-1 shrink-0 text-2xs text-dim">{field.key}</code>
        </div>
        <ErrorText msg={error} />
      </div>
    );
  }

  return (
    <div data-setting-key={settingKey}>
      {labelFor(field, id)}
      <FieldControl id={id} field={field} value={value} onChange={onChange} />
      <ErrorText msg={error} />
      <Help text={field.description} />
    </div>
  );
}

function ErrorText({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs font-medium text-danger">{msg}</p>;
}

export function SettingsForm({ schema, schemaInfo, values, onChange, issues = {} }: Props) {
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
        {schemaInfo && (
          <p data-testid="schema-source" className="mb-2 text-xs text-muted">
            {schemaSourceLine(schemaInfo)}
          </p>
        )}
        <div className="relative mb-5">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2 text-dim" />
          <input
            data-testid="settings-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="focus-ring w-full rounded-md border border-dim bg-surface2 py-1.5 pl-8 pr-2 text-sm text-ink placeholder:text-dim"
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
                  // Words in the text colour on the warning tint (warning text there is 4.1:1 in
                  // light); the warning colour goes on the border and the icon, as in Banner.
                  <div
                    key={field.key}
                    className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-ink"
                  >
                    <KeyRound size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
                    <p>
                      <strong>{field.label}</strong> is a secret — set it in the <em>Secrets &amp; Env</em> tab (stored in
                      the Keychain, injected as an env var). Not written to the config file.
                    </p>
                  </div>
                );
              }
              if (field.kind === 'nested' && field.children) {
                const nestedVal = (values[field.key] as Record<string, unknown>) ?? {};
                return (
                  <div key={field.key} data-setting-key={field.key} className="rounded-md border border-line p-3">
                    {labelFor(field)}
                    <Help text={field.description} />
                    <div className="mt-3 space-y-3 pl-3">
                      {field.children.map((child) => (
                        <FieldRow
                          key={child.key}
                          field={child}
                          settingKey={`${field.key}.${child.key}`}
                          value={nestedVal[child.key]}
                          onChange={(v) => onChange(field.key, { ...nestedVal, [child.key]: v })}
                        />
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <FieldRow
                  key={field.key}
                  field={field}
                  settingKey={field.key}
                  value={values[field.key]}
                  onChange={(v) => onChange(field.key, v)}
                  error={issues[field.key]}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
