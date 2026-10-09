import { useEffect, useReducer, type ReactNode } from 'react';
import type {
  EffectiveSchemaInfo,
  Profile,
  SecretDescriptor,
  SecretKey,
  ValidationIssue,
  XenonSchema
} from '@shared/types';
import { OctagonAlert } from 'lucide-react';
import { SHELL } from '../copy/shell';
import { hasTechnicalProblem, showsTechnicalGroup, technicalHold } from '../navigation';
import { EnvVarsEditor } from '../components/EnvVarsEditor';
import { SecretsPanel } from '../components/SecretsPanel';
import { ServerGroup } from '../components/ServerGroup';
import { SettingsForm } from '../components/SettingsForm';
import { TechnicalGroup } from '../components/TechnicalGroup';
import { Switch } from '../components/ui/Switch';
import { TabList, TabPanel, TabTrigger, Tabs } from '../components/ui/Tabs';

/** The tabs inside Settings. */
export type SettingsTab = 'all' | 'keys';

interface Props {
  profile: Profile;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  /** Every problem with the profile's settings, the port's included. */
  issues: ValidationIssue[];
  portText: string;
  onPortChange: (text: string) => void;
  schema: XenonSchema | null;
  schemaInfo: EffectiveSchemaInfo | null;
  onSetting: (key: string, value: unknown) => void;
  autoHome: { path: string; source: string } | null;
  onServerField: <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) => void;
  onPreview: () => void;
  onExportConfig: () => void;
  serverActive: boolean;
  secretDescriptors: SecretDescriptor[];
  onToggleSecret: (key: SecretKey, on: boolean) => void;
  onEnv: (env: Record<string, string>) => void;
  technicalDetails: boolean;
  onTechnicalDetails: (on: boolean) => void;
}

const S = SHELL.settings;

/**
 * Settings, until its own screens (B5): All settings (the port, every option,
 * and the Technical group) and Keys & accounts (the secrets, and environment
 * variables with technical details on). The Show technical details switch is
 * at the bottom.
 */
export function Settings(p: Props) {
  const issueMap = Object.fromEntries(p.issues.map((i) => [i.path, i.message]));

  return (
    <div className="space-y-6">
      <Tabs value={p.tab} onValueChange={(v) => p.onTab(v === 'keys' ? 'keys' : 'all')}>
        <TabList aria-label={S.sections} className="mb-5">
          <TabTrigger value="all">{S.allSettings}</TabTrigger>
          <TabTrigger value="keys">{S.keysAndAccounts}</TabTrigger>
        </TabList>
        <TabPanel value="all" className="space-y-6">
          {p.issues.length > 0 && (
            // Words in the text colour on the danger tint (danger text there is under 4.5:1 in
            // light); the danger colour goes on the border and the icon, as in Banner.
            <div className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-ink">
              <OctagonAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <strong>{S.issues(p.issues.length)}</strong>
                <ul className="mt-1 list-disc pl-5">
                  {p.issues.map((i, idx) => (
                    <li key={idx}>
                      {i.label}: {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <ServerGroup portText={p.portText} onPortChange={p.onPortChange} portError={issueMap['server.port']} />
          {/* Every option of the option list; B5 rebuilds it in plain words (the e2e no-jargon check leaves it out until then). */}
          <div data-testid="all-options">
            {p.schema ? (
              <SettingsForm
                schema={p.schema}
                schemaInfo={p.schemaInfo}
                values={p.profile.settings}
                onChange={p.onSetting}
                issues={issueMap}
              />
            ) : (
              <p className="text-sm text-dim">{SHELL.loading}</p>
            )}
          </div>
          <TechnicalSlot
            // Another profile starts afresh: what held the group was about this one.
            key={p.profile.id}
            technicalDetails={p.technicalDetails}
            problem={hasTechnicalProblem(p.issues.map((i) => i.path))}
          >
            <TechnicalGroup
              profile={p.profile}
              issues={issueMap}
              autoHome={p.autoHome}
              onServerField={p.onServerField}
              onOpenAppiumFolder={() => window.xenon.server.openPath('appiumHome', p.profile)}
              onPreview={p.onPreview}
              onExportConfig={p.onExportConfig}
              serverActive={p.serverActive}
            />
          </TechnicalSlot>
        </TabPanel>
        <TabPanel value="keys" className="space-y-6">
          {/* The secrets; B5 rebuilds them in plain words (the e2e no-jargon check leaves them out until then). */}
          <div data-testid="secrets-list">
            <SecretsPanel
              descriptors={p.secretDescriptors}
              selected={p.profile.secretRefs}
              onToggleSelected={p.onToggleSecret}
            />
          </div>
          {p.technicalDetails && <EnvVarsEditor env={p.profile.env ?? {}} onChange={p.onEnv} />}
        </TabPanel>
      </Tabs>
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

/**
 * Where the Technical group goes in All settings, and whether it is there (see
 * showsTechnicalGroup). It lives inside the tab, so leaving Settings or the tab
 * forgets what held it. Focus leaving the window (another app) is not focus
 * leaving the group: the field gets it back on return.
 */
function TechnicalSlot({
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

  if (!showsTechnicalGroup(technicalDetails, problem, hold)) return null;
  return (
    <div
      onFocus={() => dispatch({ type: 'focus' })}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null) || !document.hasFocus()) return;
        dispatch({ type: 'blur', problem });
      }}
    >
      {children}
    </div>
  );
}
