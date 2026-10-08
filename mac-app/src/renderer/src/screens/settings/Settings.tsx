import { useState } from 'react';
import type {
  EffectiveSchemaInfo,
  Profile,
  SecretKey,
  ServerState,
  ValidationIssue,
  XenonSchema
} from '@shared/types';
import { hubOpenAfter, hubOpenFor } from '../../essentials';
import { hasTechnicalProblem } from '../../navigation';
import { issueLabel } from '../../optionCatalog';
import { restartNeeded } from '../../restartHint';
import { isServerActive } from '../../serverStatus';
import { SETTINGS } from '../../copy/settings';
import { Banner } from '../../components/ui/Banner';
import { TabList, TabPanel, TabTrigger, Tabs } from '../../components/ui/Tabs';
import { AllSettings } from './AllSettings';
import { Essentials } from './Essentials';
import { KeysAndAccounts } from './KeysAndAccounts';
import { Technical, TechnicalSlot } from './Technical';
import { useSecrets } from './useSecrets';

/** The tabs inside Settings. */
export type SettingsTab = 'essentials' | 'all' | 'keys';

const TABS: readonly SettingsTab[] = ['essentials', 'all', 'keys'];
const isTab = (value: string): value is SettingsTab => (TABS as readonly string[]).includes(value);

export interface SettingsProps {
  /**
   * The open profile, as edited on screen. The screen is drawn afresh for
   * another profile (App keys it by profile id): every editor that keeps text
   * of its own (a number being typed, a table cell, a JSON box, the search box)
   * and the hub section start from the new profile's values.
   */
  profile: Profile;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  /** Every problem with the profile's settings, the port's included. */
  issues: ValidationIssue[];
  portText: string;
  onPortChange: (text: string) => void;
  schema: XenonSchema | null;
  schemaInfo: EffectiveSchemaInfo | null;
  /** Changes the draft (the Essentials rows write whole profiles). */
  update: (fn: (p: Profile) => Profile) => void;
  onSetting: (key: string, value: unknown) => void;
  autoHome: { path: string; source: string } | null;
  onServerField: <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) => void;
  onPreview: () => void;
  onExportConfig: () => void;
  server: ServerState;
  onToggleSecret: (key: SecretKey, on: boolean) => void;
  onEnv: (env: Record<string, string>) => void;
  technicalDetails: boolean;
  onTechnicalDetails: (on: boolean) => void;
}

const S = SETTINGS.screen;

/**
 * Settings: Essentials (the everyday options), All settings (every option, and
 * the Technical group) and Keys & accounts (every Keychain secret). Every
 * problem with the settings is listed above the tabs, whichever is open, and
 * under its own field.
 */
export function Settings(p: SettingsProps) {
  const issueMap = Object.fromEntries(p.issues.map((i) => [i.path, i.message]));
  // Whether the hub section is held open (EssentialCtx.hubOpen). It starts from the profile; another
  // profile draws the screen afresh, which starts it again.
  const [hubOpen, setHubOpen] = useState(() => hubOpenFor(p.profile));
  const secrets = useSecrets(`${p.tab}|${(p.profile.secretRefs ?? []).join(',')}`);
  const restart = restartNeeded(p.server, p.profile);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 pt-6">
      <h1 className="text-xl font-semibold text-ink">{S.title}</h1>

      {p.issues.length > 0 && (
        // Each problem is also announced, as it appears, under its own field.
        <Banner tone="danger" title={S.issues(p.issues.length)} announce={false}>
          <ul className="list-disc pl-5">
            {p.issues.map((issue, index) => (
              <li key={index}>{S.issueLine(issueLabel(issue), issue.message)}</li>
            ))}
          </ul>
        </Banner>
      )}

      <Tabs value={p.tab} onValueChange={(value) => isTab(value) && p.onTab(value)}>
        <TabList aria-label={S.tabsLabel} className="mb-5">
          <TabTrigger value="essentials">{S.tabs.essentials}</TabTrigger>
          <TabTrigger value="all">{S.tabs.all}</TabTrigger>
          <TabTrigger value="keys">{S.tabs.keys}</TabTrigger>
        </TabList>

        <TabPanel value="essentials">
          <Essentials
            profile={p.profile}
            schema={p.schema}
            update={p.update}
            issues={issueMap}
            portText={p.portText}
            onPortChange={p.onPortChange}
            portNeedsRestart={restart.includes('server.port')}
            hubOpen={hubOpen}
            onHub={(event) => setHubOpen((open) => hubOpenAfter(open, event))}
            secrets={secrets}
            technicalDetails={p.technicalDetails}
            onTechnicalDetails={p.onTechnicalDetails}
          />
        </TabPanel>

        <TabPanel value="all">
          <AllSettings
            schema={p.schema}
            schemaInfo={p.schemaInfo}
            values={p.profile.settings}
            onSetting={p.onSetting}
            issues={issueMap}
            technicalDetails={p.technicalDetails}
            onOpenKeys={() => p.onTab('keys')}
            technical={
              <TechnicalSlot
                technicalDetails={p.technicalDetails}
                problem={hasTechnicalProblem(p.issues.map((i) => i.path))}
              >
                <Technical
                  profile={p.profile}
                  issues={issueMap}
                  autoHome={p.autoHome}
                  onServerField={p.onServerField}
                  onEnv={p.onEnv}
                  onOpenAppiumFolder={() => void window.xenon.server.openPath('appiumHome', p.profile)}
                  onPreview={p.onPreview}
                  onExportConfig={p.onExportConfig}
                  serverActive={isServerActive(p.server.status)}
                  restart={restart}
                  technicalDetails={p.technicalDetails}
                />
              </TechnicalSlot>
            }
          />
        </TabPanel>

        <TabPanel value="keys">
          <KeysAndAccounts
            profile={p.profile}
            secrets={secrets}
            onUsed={p.onToggleSecret}
            technicalDetails={p.technicalDetails}
          />
        </TabPanel>
      </Tabs>
      {secrets.dialog}
    </div>
  );
}
