import { useEffect, useState, type ReactNode } from 'react';
import type { LaunchSpec, Profile } from '@shared/types';
import { Copy, Download } from 'lucide-react';
import { COMMON } from '../copy/common';
import { SHELL } from '../copy/shell';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { toast } from './ui/toastStore';

interface Props {
  profile: Profile;
  onClose: () => void;
}

// A dry-run: shows the exact command, environment variable NAMES (never values),
// and the fully-resolved Appium config YAML that Start would use. Nothing here
// reveals a secret value — only which keys are injected.
//
// The window is a Dialog, so Escape, the focus trap and giving focus back to the
// button that opened it are Radix's.
export function LaunchPreview({ profile, onClose }: Props) {
  const [spec, setSpec] = useState<LaunchSpec | null>(null);

  useEffect(() => {
    window.xenon.server.launchPreview(profile).then(setSpec);
  }, [profile]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Launch preview — dry run"
      className="max-w-3xl"
    >
      {!spec ? (
        <div className="p-6 text-sm text-dim">Building preview…</div>
      ) : (
        <div className="space-y-4 overflow-auto p-5">
          <Section title="Command">
            <code className="block break-all rounded-md border border-line bg-app p-3 font-mono text-xs text-accent">
              {spec.command} {spec.args.join(' ')}
            </code>
          </Section>

          <Section title="APPIUM_HOME">
            <code className="block break-all text-xs text-muted">{spec.appiumHome}</code>
          </Section>

          <Section title={`Environment variables (${spec.envKeys.length}) — names only`}>
            <div className="flex flex-wrap gap-1.5">
              {spec.envKeys.map((k) => (
                <span key={k} className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-2xs">
                  {k}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Generated Appium config (server.plugin.xenon)">
            <div className="relative">
              <pre className="max-h-72 overflow-auto rounded-md border border-line bg-app p-3 font-mono text-2xs leading-relaxed text-ink">
                {spec.configYaml}
              </pre>
              <Button
                size="sm"
                className="absolute right-2 top-2"
                icon={<Copy size={14} />}
                onClick={() => {
                  void navigator.clipboard.writeText(spec.configYaml);
                  toast('Config copied');
                }}
              >
                {COMMON.copy}
              </Button>
            </div>
          </Section>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button
          icon={<Download size={14} />}
          onClick={() => window.xenon.profiles.exportConfigYaml(profile).then((ok) => ok && toast(SHELL.settings.configSaved))}
        >
          Save config…
        </Button>
        <Button variant="primary" onClick={onClose}>
          {COMMON.close}
        </Button>
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}
