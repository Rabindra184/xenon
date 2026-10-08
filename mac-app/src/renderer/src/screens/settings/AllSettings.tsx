import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import type { EffectiveSchemaInfo, SettingsValues, XenonSchema } from '@shared/types';
import { allSettingsSections } from '../../allSettings';
import { schemaSourceLine } from '../../schemaSource';
import { SETTINGS } from '../../copy/settings';
import { SHELL } from '../../copy/shell';
import { Group } from '../../components/ui/Group';
import { FieldEditor } from './FieldEditor';

const A = SETTINGS.allSettings;

export interface AllSettingsProps {
  /** The option list in use; null while it is read. */
  schema: XenonSchema | null;
  /** Where it came from, for the line above the search box (technical details). */
  schemaInfo: EffectiveSchemaInfo | null;
  values: SettingsValues;
  onSetting: (key: string, value: unknown) => void;
  /** Problems keyed by option, shown under the field. */
  issues: Record<string, string>;
  technicalDetails: boolean;
  onOpenKeys: () => void;
  /** The Technical group, at the end. */
  technical: ReactNode;
}

/**
 * Every option of the option list in use, in the catalog's plain words and
 * groups, with a search box. With technical details on, each option also shows
 * its raw name and Xenon's own description, the search finds raw names too, and
 * the line above the search box says which Xenon the options are from.
 *
 * The search box keeps its own text: the screen is drawn afresh for another
 * profile (Settings is keyed by profile id), so it starts empty there.
 */
export function AllSettings({
  schema,
  schemaInfo,
  values,
  onSetting,
  issues,
  technicalDetails,
  onOpenKeys,
  technical
}: AllSettingsProps) {
  const [query, setQuery] = useState('');
  const sections = useMemo(
    () => (schema ? allSettingsSections(schema, { technical: technicalDetails, query }) : []),
    [schema, technicalDetails, query]
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {technicalDetails && schemaInfo && (
          <p data-testid="schema-source" className="text-xs text-muted">
            {schemaSourceLine(schemaInfo)}
          </p>
        )}
        <div className="relative">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 text-dim" />
          <input
            type="search"
            data-testid="settings-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={A.search}
            aria-label={A.search}
            className="focus-ring h-8 w-full rounded-md border border-dim bg-surface2 pl-8 pr-2 text-sm text-ink placeholder:text-dim"
          />
        </div>
      </div>

      {!schema ? (
        <p className="text-sm text-muted">{SHELL.loading}</p>
      ) : sections.length === 0 ? (
        <p className="text-sm text-muted">{A.noMatch(query.trim())}</p>
      ) : (
        sections.map((section) => (
          <Group key={section.group} title={section.group}>
            {section.fields.map((field) => (
              <FieldEditor
                key={field.rawKey}
                field={field}
                label={field.entry.label}
                // A fallback's help is Xenon's own first sentence, which may name options or paths:
                // technical details only.
                help={field.fallback && !technicalDetails ? undefined : field.entry.help || undefined}
                path={field.rawKey}
                value={values[field.rawKey]}
                onChange={(value) => onSetting(field.rawKey, value)}
                error={issues[field.rawKey]}
                issueFor={(part) => issues[part]}
                inverted={field.inverted}
                overridable={field.overridable}
                technicalDetails={technicalDetails}
                onOpenKeys={onOpenKeys}
              />
            ))}
          </Group>
        ))
      )}

      {technical}
    </div>
  );
}
