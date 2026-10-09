import type { Profile } from '@shared/types';
import { DEFAULT_KEEP_ALIVE_SECONDS } from '@shared/profileDefaults';
import { Download, Eye, FolderOpen } from 'lucide-react';
import { SHELL } from '../copy/shell';
import { Button } from './ui/Button';
import { Group } from './ui/Group';
import { NumberField } from './ui/NumberField';
import { TextField } from './ui/TextField';

interface Props {
  profile: Profile;
  /** Problems keyed by setting path (`server.basePath`), shown under the field. */
  issues: Record<string, string>;
  /** What an empty Appium folder resolves to on this Mac, so "automatic" is visible rather than magic. */
  autoHome: { path: string; source: string } | null;
  onServerField: <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) => void;
  onOpenAppiumFolder: () => void;
  onPreview: () => void;
  onExportConfig: () => void;
  /** The server is starting, running or stopping. */
  serverActive: boolean;
}

const S = SHELL.settings;

/**
 * The server's technical settings, at the end of Settings with technical
 * details on: base path, Appium folder and keep-alive, each marked with its
 * `server.*` key so a start that finds a problem can put the cursor in it.
 * Also the launch preview and the config export.
 */
export function TechnicalGroup({
  profile,
  issues,
  autoHome,
  onServerField,
  onOpenAppiumFolder,
  onPreview,
  onExportConfig,
  serverActive
}: Props) {
  const home = profile.server.appiumHome;

  return (
    <Group title={S.technical}>
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
            error={issues['server.appiumHome']}
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
          error={issues['server.keepAliveTimeout']}
        />
      </div>
      <div className="flex flex-wrap gap-2 py-3">
        <Button
          data-testid="preview-button"
          onClick={onPreview}
          disabled={serverActive}
          icon={<Eye size={14} aria-hidden="true" />}
        >
          {S.previewLaunch}
        </Button>
        <Button onClick={onExportConfig} icon={<Download size={14} aria-hidden="true" />}>
          {S.exportConfig}
        </Button>
      </div>
    </Group>
  );
}
