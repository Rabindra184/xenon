import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import type { Profile } from '@shared/types';
import { DEFAULT_KEEP_ALIVE_SECONDS } from '@shared/profileDefaults';
import { Download, Eye, FolderOpen } from 'lucide-react';
import { showsTechnicalGroup, technicalHold } from '../../navigation';
import type { RestartField } from '../../restartHint';
import { SETTINGS } from '../../copy/settings';
import { EnvVarsEditor } from '../../components/EnvVarsEditor';
import { Button } from '../../components/ui/Button';
import { Group } from '../../components/ui/Group';
import { NumberField } from '../../components/ui/NumberField';
import { TextField } from '../../components/ui/TextField';
import { RestartHint } from './RestartHint';

const T = SETTINGS.technical;

export interface TechnicalProps {
  profile: Profile;
  /** Problems keyed by setting path (`server.basePath`), shown under the field. */
  issues: Record<string, string>;
  /** What an empty Appium folder resolves to on this Mac, so "automatic" is visible rather than magic. */
  autoHome: { path: string; source: string } | null;
  onServerField: <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) => void;
  onEnv: (env: Record<string, string>) => void;
  onOpenAppiumFolder: () => void;
  onPreview: () => void;
  onExportConfig: () => void;
  /** The server is starting, running or stopping. */
  serverActive: boolean;
  /** The server settings edited since this profile's running server started (restartHint). */
  restart: readonly RestartField[];
  /**
   * Off when the group is only here for a problem (R19): it then shows the settings that can be wrong,
   * not the environment variables, the preview or the export, which are all technical.
   */
  technicalDetails: boolean;
}

/**
 * All settings' Technical group, at its end: base path, Appium folder and
 * keep-alive (each marked with its `server.*` key, so a start that finds a
 * problem can put the cursor in it), the environment variables, and the launch
 * preview and config export. Shown with technical details off for a problem,
 * it holds only the three settings. A base path or Appium folder edited while the
 * server runs says it needs a restart: the server keeps what it started with.
 */
export function Technical({
  profile,
  issues,
  autoHome,
  onServerField,
  onEnv,
  onOpenAppiumFolder,
  onPreview,
  onExportConfig,
  serverActive,
  restart,
  technicalDetails
}: TechnicalProps) {
  const home = profile.server.appiumHome;

  return (
    <Group title={T.title}>
      <div className="flex flex-col gap-1 py-3">
        <TextField
          label={T.basePath}
          settingKey="server.basePath"
          value={profile.server.basePath}
          onChange={(value) => onServerField('basePath', value)}
          error={issues['server.basePath']}
        />
        <RestartHint show={restart.includes('server.basePath')} />
      </div>
      <div className="flex flex-col items-start gap-2 py-3">
        <div className="w-full">
          <TextField
            label={T.appiumFolder}
            settingKey="server.appiumHome"
            data-testid="appium-home"
            value={home}
            onChange={(value) => onServerField('appiumHome', value)}
            description={T.appiumFolderHelp}
            placeholder={autoHome && !home ? T.appiumFolderAuto(autoHome.path) : T.appiumFolderAutoUnknown}
            title={home ? T.appiumFolderOverride : autoHome ? T.appiumFolderDetected(autoHome.source, autoHome.path) : undefined}
            error={issues['server.appiumHome']}
          />
          <RestartHint show={restart.includes('server.appiumHome')} />
        </div>
        <Button size="sm" onClick={onOpenAppiumFolder} icon={<FolderOpen size={14} aria-hidden="true" />}>
          {T.openAppiumFolder}
        </Button>
      </div>
      <div className="py-3">
        <NumberField
          label={T.keepAlive}
          settingKey="server.keepAliveTimeout"
          value={profile.server.keepAliveTimeout}
          unit="plain"
          min={0}
          suffix={T.seconds}
          onCommit={(value) => onServerField('keepAliveTimeout', value ?? DEFAULT_KEEP_ALIVE_SECONDS)}
          error={issues['server.keepAliveTimeout']}
        />
      </div>
      {technicalDetails && (
        <>
          <EnvVarsEditor env={profile.env ?? {}} onChange={onEnv} />
          <div className="flex flex-wrap gap-2 py-3">
            <Button
              data-testid="preview-button"
              onClick={onPreview}
              disabled={serverActive}
              icon={<Eye size={14} aria-hidden="true" />}
            >
              {T.previewLaunch}
            </Button>
            <Button onClick={onExportConfig} icon={<Download size={14} aria-hidden="true" />}>
              {T.exportConfig}
            </Button>
          </div>
        </>
      )}
    </Group>
  );
}

/**
 * Where the Technical group goes in All settings, and whether it is there (see
 * showsTechnicalGroup). With technical details off it is there while one of its
 * settings has a problem, and stays while that is being fixed (R19). It lives
 * inside the tab, so leaving Settings or the tab forgets what held it. Focus
 * leaving the window (another app) is not focus leaving the group: the field
 * gets it back on return.
 *
 * A click that takes focus out of the group lands where it was aimed: the group
 * stays until the pointer is up, so nothing moves under it between press and
 * release (a page scrolled to its end would otherwise shift up by the group's
 * height, and the click would land elsewhere or nowhere).
 */
export function TechnicalSlot({
  technicalDetails,
  problem,
  children
}: {
  technicalDetails: boolean;
  /** One of the group's settings has a problem. */
  problem: boolean;
  children: ReactNode;
}) {
  const [hold, dispatch] = useReducer(technicalHold, { held: problem, focused: false });
  useEffect(() => dispatch({ type: 'problem', problem }), [problem]);
  const pointerDown = usePointerDown();
  // The latest problem, for a blur that is dispatched once the pointer is up.
  const problemNow = useRef(problem);
  problemNow.current = problem;

  if (!showsTechnicalGroup(technicalDetails, problem, hold)) return null;
  return (
    <div
      onFocus={() => dispatch({ type: 'focus' })}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null) || !document.hasFocus()) return;
        const leave = () => dispatch({ type: 'blur', problem: problemNow.current });
        if (!pointerDown.current) {
          leave();
          return;
        }
        // After the click that follows this pointer's release has been handled.
        window.addEventListener('pointerup', () => setTimeout(leave, 0), { once: true, capture: true });
      }}
    >
      {children}
    </div>
  );
}

/** Whether a pointer is pressed anywhere in the window now. */
function usePointerDown() {
  const down = useRef(false);
  useEffect(() => {
    const press = () => {
      down.current = true;
    };
    const release = () => {
      down.current = false;
    };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, []);
  return down;
}
