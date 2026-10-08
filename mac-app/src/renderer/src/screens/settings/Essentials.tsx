import { useEffect, useId, useState } from 'react';
import type { Profile, XenonSchema } from '@shared/types';
import { SECRET_DESCRIPTORS } from '@shared/secrets';
import {
  dashboardCanOverride,
  rowSettingKey,
  schemaDefaults,
  visibleRows,
  type EssentialCtx,
  type EssentialRow,
  type HubOpenEvent
} from '../../essentials';
import { focusSetting } from '../../focusSetting';
import { SETTINGS } from '../../copy/settings';
import { KEYS } from '../../copy/keys';
import { FieldFrame, fieldDescribedBy } from '../../components/ui/Field';
import { Group } from '../../components/ui/Group';
import { NumberField } from '../../components/ui/NumberField';
import { SecretField } from '../../components/ui/SecretField';
import { Segmented } from '../../components/ui/Segmented';
import { Switch } from '../../components/ui/Switch';
import { TextField } from '../../components/ui/TextField';
import { inputClasses, LABEL_CLASSES } from '../../components/ui/fieldStyles';
import { ConnectAgentsGroup } from '../../components/slots/ConnectAgentsGroup';
import { ErrorText, TechnicalNote } from './FieldEditor';
import { RestartHint } from './RestartHint';
import type { SecretsApi } from './useSecrets';

const S = SETTINGS.screen;

export interface EssentialsProps {
  profile: Profile;
  /** The option list in use, for its defaults and descriptions; null while it is read. */
  schema: XenonSchema | null;
  /** Changes the profile (the draft, saved once typing settles). */
  update: (fn: (p: Profile) => Profile) => void;
  /** Changes one profile by id, for a change that lands after an await. */
  updateProfile: (id: string, fn: (p: Profile) => Profile) => void;
  /** Problems keyed by setting path, the port's included. */
  issues: Record<string, string>;
  /** The port box's own text (usePortDraft), so an emptied or half-typed port never reaches the profile. */
  portText: string;
  onPortChange: (text: string) => void;
  /** The port was edited while this profile's server runs. */
  portNeedsRestart: boolean;
  /** The screen holds the hub section open (EssentialCtx.hubOpen). */
  hubOpen: boolean;
  onHub: (event: HubOpenEvent) => void;
  secrets: SecretsApi;
  technicalDetails: boolean;
  onTechnicalDetails: (on: boolean) => void;
}

/**
 * The everyday options, in plain words (the `essentials` catalog), in groups. A
 * row appears only while it applies (the iPhone rows only when iPhones are in
 * use). Under a row: its problem, if it has one; "The dashboard can override
 * this." where Xenon says so; and with technical details on, its raw name and
 * Xenon's own description. At the bottom, Part C's agents group and the Show
 * technical details switch.
 */
export function Essentials(p: EssentialsProps) {
  const ctx: EssentialCtx = {
    defaults: schemaDefaults(p.schema),
    hubOpen: p.hubOpen,
    secretsSaved: p.secrets.saved
  };
  const rows = visibleRows(p.profile, ctx);
  const groups = [...new Set(rows.map((row) => row.group))];

  // Turning the hub on puts the cursor in its address, once the box is drawn.
  const [focusHub, setFocusHub] = useState(0);
  useEffect(() => {
    if (focusHub > 0) focusSetting('hub');
  }, [focusHub]);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <Group key={group} title={group}>
          {rows
            .filter((row) => row.group === group)
            .map((row) => (
              <RowView
                key={row.id}
                row={row}
                ctx={ctx}
                {...p}
                onHubOn={() => {
                  p.onHub({ type: 'switch', on: true });
                  setFocusHub((n) => n + 1);
                }}
              />
            ))}
        </Group>
      ))}
      <ConnectAgentsGroup />
      <div className="rounded-lg border border-line bg-surface px-4 py-3">
        <Switch
          checked={p.technicalDetails}
          onCheckedChange={p.onTechnicalDetails}
          label={S.technicalDetails}
          description={S.technicalDetailsHelp}
        />
      </div>
    </div>
  );
}

type RowProps = EssentialsProps & { row: EssentialRow; ctx: EssentialCtx; onHubOn: () => void };

/** One row: its control, then what goes under it. */
function RowView(props: RowProps) {
  const { row, schema, issues, technicalDetails } = props;
  const description =
    row.control.kind === 'secret'
      ? SECRET_DESCRIPTORS.find((d) => d.key === row.optionKey)?.description
      : schema?.properties[row.optionKey]?.description;
  // A box's problem is shown by the box (the port's too); a switch's or a choice's under the row. The
  // hub switch shares its option with the address row, which shows it.
  const key = rowSettingKey(row);
  const boxed = row.control.kind === 'number' || row.control.kind === 'text';
  return (
    <div data-setting-key={key} className="flex flex-col gap-1 py-3">
      <RowControl {...props} />
      {!boxed && key !== undefined && <ErrorText error={issues[key]} />}
      {row.id === 'port' && <RestartHint show={props.portNeedsRestart} />}
      {dashboardCanOverride(schema?.properties[row.optionKey]?.description) && (
        <p className="text-xs text-muted">{S.dashboardCanOverride}</p>
      )}
      {technicalDetails && <TechnicalNote rawKey={row.optionKey} description={description} />}
    </div>
  );
}

function RowControl(props: RowProps) {
  const { row, ctx, profile, update, issues } = props;
  const control = row.control;
  const value = row.read(profile, ctx);
  const write = (v: unknown) => update((p) => row.write(p, v));

  switch (control.kind) {
    case 'segmented':
      return <SegmentedRow label={row.label} options={control.options} value={value} onChange={write} />;
    case 'switch':
      if (row.id === 'hub') {
        return (
          <Switch
            label={row.label}
            checked={value === true}
            onCheckedChange={(on) => {
              if (on) {
                props.onHubOn();
                return;
              }
              // Off clears the address and keeps the access key, the token and whether this profile uses them.
              write(false);
              props.onHub({ type: 'switch', on: false });
            }}
          />
        );
      }
      return <Switch label={row.label} labelHint={row.help} checked={value === true} onCheckedChange={write} />;
    case 'number':
      if (row.id === 'port') return <PortRow {...props} />;
      return (
        <NumberField
          label={row.label}
          value={typeof value === 'number' ? value : undefined}
          unit={control.unit}
          min={control.min}
          max={control.max}
          step={control.step}
          suffix={control.suffix}
          error={issues[row.optionKey]}
          onCommit={write}
        />
      );
    case 'text':
      return (
        <TextField
          label={row.label}
          value={typeof value === 'string' ? value : ''}
          placeholder={control.placeholder}
          error={issues[row.optionKey]}
          onChange={(text) => {
            write(text);
            // Any edit of the hub's address keeps its rows, emptying it included.
            if (row.id === 'hubAddress') props.onHub({ type: 'address' });
          }}
        />
      );
    case 'secret':
      return <SecretRow {...props} saved={(value as { saved?: boolean } | undefined)?.saved === true} />;
  }
}

/** A few choices side by side, named by the row's label. */
function SegmentedRow({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: { value: string; label: string }[];
  value: unknown;
  onChange: (value: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span id={labelId} className={LABEL_CLASSES}>
        {label}
      </span>
      <Segmented
        aria-labelledby={labelId}
        options={options}
        value={typeof value === 'string' ? value : undefined}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * The port. Its text is the port box's own (usePortDraft): every valid
 * keystroke goes to the profile, as Start reads it, and an emptied or invalid
 * box says why ("Port is required.") and blocks Start, storing nothing.
 */
function PortRow({ row, issues, portText, onPortChange }: RowProps) {
  const id = useId();
  const error = issues[row.optionKey];
  return (
    <FieldFrame fieldId={id} label={row.label} error={error}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={portText}
        onChange={(e) => onPortChange(e.target.value)}
        // A wheel over a focused number box changes it. Scrolling the page must not.
        onWheel={(e) => e.currentTarget.blur()}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(id, { error })}
        className={`${inputClasses(!!error)} w-24`}
      />
    </FieldFrame>
  );
}

/**
 * A Keychain key. Saving one stores it and turns on "Used by this profile"
 * (the row's write(true)) for the profile Save was pressed on: the save is
 * awaited, and another profile may be open by the time it is done (R51). Clear
 * asks first, and clears only the Keychain value: whether the profile uses the
 * key stays as it is (never write(false) here).
 */
function SecretRow({ row, profile, updateProfile, secrets, saved }: RowProps & { saved: boolean }) {
  const id = useId();
  const key = row.control.kind === 'secret' ? row.control.secret : null;
  if (key === null) return null;
  return (
    <SecretField
      id={id}
      label={row.label}
      name={KEYS.secrets[key].label}
      saved={saved}
      onSave={async (value) => {
        const savedOn = profile.id;
        await secrets.save(key, value, savedOn);
        updateProfile(savedOn, (p) => row.write(p, true));
      }}
      onClear={() => secrets.askClear(key, id, profile.id)}
    />
  );
}
