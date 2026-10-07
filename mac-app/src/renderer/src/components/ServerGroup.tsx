import { useId } from 'react';
import type { Profile } from '@shared/types';
import { DEFAULT_KEEP_ALIVE_SECONDS } from '@shared/profileDefaults';
import { Eye, FolderOpen } from 'lucide-react';
import { SHELL } from '../copy/shell';
import { Button } from './ui/Button';
import { FieldFrame, fieldDescribedBy } from './ui/Field';
import { Group } from './ui/Group';
import { NumberField } from './ui/NumberField';
import { TextField } from './ui/TextField';
import { inputClasses } from './ui/fieldStyles';

interface Props {
  profile: Profile;
  /** The port box's own text, so a half-typed or cleared value never reaches the profile as NaN. */
  portText: string;
  onPortChange: (text: string) => void;
  /** Problems keyed by setting path (`server.port`, `server.basePath`), shown under the field. */
  issues: Record<string, string>;
  /** What an empty Appium folder resolves to on this Mac, so "automatic" is visible rather than magic. */
  autoHome: { path: string; source: string } | null;
  onServerField: <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) => void;
  onOpenAppiumFolder: () => void;
  onPreview: () => void;
  /** The server is starting, running or stopping. */
  serverActive: boolean;
}

const S = SHELL.settings;

/**
 * The server's own settings, at the top of Settings: port, base path, Appium
 * folder and keep-alive, each marked with its `server.*` key so a start that
 * finds a problem can put the cursor in it. Also the launch preview.
 */
export function ServerGroup({
  profile,
  portText,
  onPortChange,
  issues,
  autoHome,
  onServerField,
  onOpenAppiumFolder,
  onPreview,
  serverActive
}: Props) {
  const portId = useId();
  const portError = issues['server.port'];
  const home = profile.server.appiumHome;

  return (
    <Group title={S.server}>
      <div className="py-3">
        {/* The port commits on every valid keystroke, as Start reads it; an invalid draft blocks Start instead. */}
        <FieldFrame fieldId={portId} label={S.port} error={portError} settingKey="server.port">
          <input
            id={portId}
            type="number"
            inputMode="numeric"
            value={portText}
            onChange={(e) => onPortChange(e.target.value)}
            // A wheel over a focused number box changes it. Scrolling the page must not.
            onWheel={(e) => e.currentTarget.blur()}
            aria-invalid={portError ? true : undefined}
            aria-describedby={fieldDescribedBy(portId, { error: portError })}
            className={`${inputClasses(!!portError)} w-24`}
          />
        </FieldFrame>
      </div>
      <div className="py-3">
        <TextField
          label={S.basePath}
          settingKey="server.basePath"
          value={profile.server.basePath}
          onChange={(value) => onServerField('basePath', value)}
          error={issues['server.basePath']}
        />
      </div>
      <div className="flex flex-col items-start gap-2 py-3">
        <div className="w-full">
          <TextField
            label={S.appiumFolder}
            settingKey="server.appiumHome"
            data-testid="appium-home"
            value={home}
            onChange={(value) => onServerField('appiumHome', value)}
            description={S.appiumFolderHelp}
            placeholder={autoHome && !home ? S.appiumFolderAuto(autoHome.path) : S.appiumFolderAutoUnknown}
            title={home ? S.appiumFolderOverride : autoHome ? S.appiumFolderDetected(autoHome.source, autoHome.path) : undefined}
          />
        </div>
        <Button size="sm" onClick={onOpenAppiumFolder} icon={<FolderOpen size={14} aria-hidden="true" />}>
          {S.openAppiumFolder}
        </Button>
      </div>
      <div className="py-3">
        <NumberField
          // A draft in the box belongs to the profile it was typed for.
          key={profile.id}
          label={S.keepAlive}
          settingKey="server.keepAliveTimeout"
          value={profile.server.keepAliveTimeout}
          unit="plain"
          min={0}
          suffix={S.seconds}
          onCommit={(value) => onServerField('keepAliveTimeout', value ?? DEFAULT_KEEP_ALIVE_SECONDS)}
        />
      </div>
      <div className="py-3">
        <Button
          data-testid="preview-button"
          onClick={onPreview}
          disabled={serverActive}
          icon={<Eye size={14} aria-hidden="true" />}
        >
          {S.previewLaunch}
        </Button>
      </div>
    </Group>
  );
}
