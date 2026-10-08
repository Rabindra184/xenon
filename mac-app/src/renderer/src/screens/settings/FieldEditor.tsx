import { useId, type ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import type { FormField } from '../../schemaForm';
import { choiceClearable, choiceLabel, choiceOrder, columnLabel, partLabel, rawValueText } from '../../optionCatalog';
import { columnsFor } from '../../editorModel';
import { SETTINGS } from '../../copy/settings';
import { Button } from '../../components/ui/Button';
import { ChipListEditor } from '../../components/ui/ChipListEditor';
import { JsonField } from '../../components/ui/JsonField';
import { NumberField } from '../../components/ui/NumberField';
import { ObjectTableEditor } from '../../components/ui/ObjectTableEditor';
import { Segmented } from '../../components/ui/Segmented';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { TextField } from '../../components/ui/TextField';
import { ERROR_CLASSES, LABEL_CLASSES } from '../../components/ui/fieldStyles';

const A = SETTINGS.allSettings;

/** A choice list's value for "nothing chosen": a Select can't hold an empty one. */
const DEFAULT_CHOICE = '__default__';

/** Segmented controls take up to four choices; more go in a list. */
const SEGMENTED_MAX = 4;

export interface FieldEditorProps {
  /** The option, or a part of one, as the form model made it. */
  field: FormField;
  /** The plain label and help line shown for it. Help is left out when undefined. */
  label: string;
  help?: string;
  /** The option or part's dotted path: its wrapper's data-setting-key, and whose choices are named. */
  path: string;
  value: unknown;
  onChange: (value: unknown) => void;
  /** What is wrong with the stored value, under it. */
  error?: string;
  /** What is wrong with a part of a nested option, by the part's dotted path (`cloud.url`). */
  issueFor?: (path: string) => string | undefined;
  /** The label says the opposite of the option (sign-in, R46): the switch is on when the option is off or unset. */
  inverted?: boolean;
  /** Xenon says a value saved in the dashboard replaces this one. */
  overridable?: boolean;
  /** Shows the raw name and Xenon's own description under it. */
  technicalDetails: boolean;
  /** Opens Keys & accounts, for a secret. */
  onOpenKeys: () => void;
}

/**
 * One option of All settings (or a part of one, for a nested option), with the
 * control its kind needs. A secret never gets a box: the form saves while
 * someone types, and a key saved a few letters at a time is not a key (R39). It
 * points to Keys & accounts instead, where a secret is entered whole.
 */
export function FieldEditor(props: FieldEditorProps) {
  const { field, path } = props;
  if (field.secret) return <SecretPointer {...props} />;
  return (
    <div data-setting-key={path} className="flex flex-col gap-1 py-3">
      <Control {...props} />
      {/* A nested option's notes go above its parts, which carry their own. */}
      {field.kind !== 'nested' && <Notes {...props} />}
    </div>
  );
}

/** The control for the field's kind, with its label and (where the control has a place for it) its help and error. */
function Control(props: FieldEditorProps) {
  const { field, label, help, path, value, onChange, error, inverted } = props;
  const id = `setting-${path}`;
  const labelId = `${id}-label`;
  const effective = value ?? field.default;

  switch (field.kind) {
    case 'toggle': {
      // An inverted option: on means it is off or unset; turning the switch off saves `true`. Turning
      // it back on removes the option, back to its default (off), as Essentials' sign-in row does.
      const on = inverted ? !effective : !!effective;
      return (
        <>
          <Switch
            id={id}
            label={label}
            description={help}
            checked={on}
            onCheckedChange={(next) => onChange(inverted ? (next ? undefined : true) : next)}
          />
          <ErrorText error={error} />
        </>
      );
    }
    case 'number':
      return (
        <NumberField
          id={id}
          label={label}
          description={help}
          error={error}
          value={typeof effective === 'number' ? effective : undefined}
          unit="plain"
          min={field.min}
          max={field.max}
          onCommit={onChange}
        />
      );
    case 'select': {
      // In the catalog's order, as Essentials shows them.
      const options = choiceOrder(path, field.enum ?? []).map((v) => ({ value: v, label: choiceLabel(path, v) }));
      const chosen = typeof effective === 'string' ? effective : undefined;
      if (options.length <= SEGMENTED_MAX) {
        return (
          <Labelled label={label} labelId={labelId} help={help} error={error}>
            {choiceClearable(field) ? (
              // No default: clicking the chosen choice clears it, and Xenon decides.
              <Segmented aria-labelledby={labelId} options={options} value={chosen} clearable onChange={onChange} />
            ) : (
              // A default shows when nothing is chosen, so a choice stays chosen.
              <Segmented aria-labelledby={labelId} options={options} value={chosen} onChange={onChange} />
            )}
          </Labelled>
        );
      }
      return (
        <>
          <Select
            id={id}
            label={label}
            value={chosen ?? DEFAULT_CHOICE}
            onValueChange={(v) => onChange(v === DEFAULT_CHOICE ? undefined : v)}
            options={[{ value: DEFAULT_CHOICE, label: A.defaultChoice }, ...options]}
          />
          <HelpText help={help} />
          <ErrorText error={error} />
        </>
      );
    }
    case 'stringList':
      return (
        <Labelled label={label} htmlFor={id} help={help} error={error}>
          <ChipListEditor
            id={id}
            value={Array.isArray(effective) ? (effective as string[]) : []}
            onChange={onChange}
          />
        </Labelled>
      );
    case 'json': {
      const columns = columnsFor(field);
      if (!columns) {
        return (
          <Labelled label={label} htmlFor={id} help={help} error={error}>
            <JsonField id={id} value={effective} onChange={onChange} />
          </Labelled>
        );
      }
      const rows = Array.isArray(effective) ? (effective as Array<Record<string, string>>) : [];
      return (
        <Labelled label={label} labelId={labelId} help={help} error={error}>
          <ObjectTableEditor
            labelledBy={labelId}
            columns={columns.map((key) => ({ key, label: columnLabel(key) }))}
            value={rows}
            onChange={onChange}
          />
        </Labelled>
      );
    }
    case 'nested':
      return <Nested {...props} />;
    default:
      // Text. An option's default is a hint in the empty box, not a value in it, so the box can be emptied.
      return (
        <TextField
          id={id}
          label={label}
          description={help}
          error={error}
          value={typeof value === 'string' ? value : ''}
          placeholder={typeof field.default === 'string' ? field.default : undefined}
          onChange={(text) => onChange(text === '' ? undefined : text)}
        />
      );
  }
}

/** A nested option (automatic waiting, network capture, the cloud): its label and help, then each part. */
function Nested(props: FieldEditorProps) {
  const { field, label, help, path, value, onChange, error, technicalDetails, onOpenKeys, issueFor } = props;
  const labelId = useId();
  const jsonId = `setting-${path}-json`;
  const isParts = value !== null && typeof value === 'object' && !Array.isArray(value);
  // A value the parts can't show (a proxy written as one address) is edited whole, so nothing of it is lost.
  if (value !== undefined && !isParts) {
    return (
      <Labelled label={label} htmlFor={jsonId} help={help} error={error}>
        <JsonField id={jsonId} value={value} onChange={onChange} />
      </Labelled>
    );
  }
  const parts = isParts ? (value as Record<string, unknown>) : {};
  // A part emptied goes; with none left, the option goes too, back to Xenon's default.
  const withPart = (key: string, v: unknown) => {
    const next = { ...parts, [key]: v };
    return Object.values(next).every((p) => p === undefined) ? undefined : next;
  };
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1">
      <p id={labelId} className={LABEL_CLASSES}>
        {label}
      </p>
      <HelpText help={help} />
      <ErrorText error={error} />
      <Notes {...props} />
      <div className="mt-1 border-l-2 border-line pl-4">
        {(field.children ?? []).map((child) => {
          const childPath = `${path}.${child.key}`;
          return (
            <FieldEditor
              key={child.key}
              field={child}
              label={partLabel(childPath)}
              // A part's only words are Xenon's own: they are technical details.
              path={childPath}
              value={parts[child.key]}
              onChange={(v) => onChange(withPart(child.key, v))}
              error={issueFor?.(childPath)}
              issueFor={issueFor}
              technicalDetails={technicalDetails}
              onOpenKeys={onOpenKeys}
            />
          );
        })}
      </div>
      {/* With technical details on, an option that can hold more than its parts is offered whole as JSON. */}
      {technicalDetails && field.jsonView && (
        <div className="mt-2">
          <Labelled label={A.asJson(label)} htmlFor={jsonId}>
            <JsonField id={jsonId} value={value} onChange={onChange} />
          </Labelled>
        </div>
      )}
    </div>
  );
}

/** In place of a secret's box: where it is entered, and a way there. */
function SecretPointer({ label, help, path, technicalDetails, field, onOpenKeys }: FieldEditorProps) {
  return (
    <div data-setting-key={path} className="flex flex-col gap-1 py-3">
      {/* Words in the text colour on the warning tint (warning text there is 4.1:1 in light); the
          warning colour goes on the border and the icon, as in Banner. */}
      <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink">
        <KeyRound size={14} aria-hidden="true" className="mt-1 shrink-0 text-warn" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <p className="min-w-0 flex-1">
            <strong>{label}</strong> {A.secretPointer.before} <em>{SETTINGS.screen.tabs.keys}</em>.{' '}
            {A.secretPointer.after}
          </p>
          <Button size="sm" onClick={onOpenKeys}>
            {A.openKeys}
          </Button>
        </div>
      </div>
      <HelpText help={help} />
      {technicalDetails && <TechnicalNote rawKey={path} description={field.description} />}
    </div>
  );
}

/**
 * What goes under a field: the dashboard note, and with technical details on, the raw name and Xenon's
 * description. An inverted switch (sign-in) also shows the raw value, which its words say the opposite of.
 */
function Notes({ path, field, value, overridable, inverted, technicalDetails }: FieldEditorProps) {
  return (
    <>
      {overridable && <p className="text-xs text-muted">{SETTINGS.screen.dashboardCanOverride}</p>}
      {technicalDetails && (
        <TechnicalNote
          rawKey={path}
          description={field.description}
          raw={inverted ? rawValueText(path, value ?? field.default ?? false) : undefined}
        />
      )}
    </>
  );
}

/**
 * The raw name (mono) and Xenon's own description: technical details, quoted rather than the app's
 * words. `raw` replaces the name with the name and its stored value (`authDisabled: false`).
 */
export function TechnicalNote({ rawKey, description, raw }: { rawKey: string; description?: string; raw?: string }) {
  return (
    <div data-raw className="flex flex-col gap-0.5 text-2xs text-muted">
      <code className="font-mono">{raw ?? rawKey}</code>
      {description && <p>{description}</p>}
    </div>
  );
}

/** A label above a control that is not a single box (a segmented choice, a table) or a box the kit doesn't label. */
function Labelled({
  label,
  labelId,
  htmlFor,
  help,
  error,
  children
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={LABEL_CLASSES}>
          {label}
        </label>
      ) : (
        <p id={labelId} className={LABEL_CLASSES}>
          {label}
        </p>
      )}
      <div>{children}</div>
      <HelpText help={help} />
      <ErrorText error={error} />
    </div>
  );
}

function HelpText({ help }: { help?: string }) {
  if (!help) return null;
  return <p className="text-xs text-muted">{help}</p>;
}

export function ErrorText({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={ERROR_CLASSES}>
      {error}
    </p>
  );
}
