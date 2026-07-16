import { useEffect, useState, type ReactNode } from 'react';
import type { LaunchSpec, Profile } from '@shared/types';
import { Copy, Download, X } from 'lucide-react';

interface Props {
  profile: Profile;
  onClose: () => void;
}

// A dry-run: shows the exact command, environment variable NAMES (never values),
// and the fully-resolved Appium config YAML that Start would use. Nothing here
// reveals a secret value — only which keys are injected.
export function LaunchPreview({ profile, onClose }: Props) {
  const [spec, setSpec] = useState<LaunchSpec | null>(null);

  useEffect(() => {
    window.xenon.server.launchPreview(profile).then(setSpec);
  }, [profile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Launch preview"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">Launch preview — dry run</h2>
          <button onClick={onClose} aria-label="Close preview" className="focus-ring rounded text-dim hover:text-ink">
            <X size={18} />
          </button>
        </div>

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
                  <span key={k} className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-[11px]">
                    {k}
                  </span>
                ))}
              </div>
            </Section>

            <Section title="Generated Appium config (server.plugin.xenon)">
              <div className="relative">
                <pre className="max-h-72 overflow-auto rounded-md border border-line bg-app p-3 font-mono text-[11px] leading-relaxed text-ink">
                  {spec.configYaml}
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(spec.configYaml)}
                  className="focus-ring absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-line-strong bg-surface2 px-2 py-1 text-[11px] text-ink hover:bg-surface"
                >
                  <Copy size={11} /> Copy
                </button>
              </div>
            </Section>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            onClick={() => window.xenon.profiles.exportConfigYaml(profile)}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-surface2"
          >
            <Download size={14} /> Save config…
          </button>
          <button
            onClick={onClose}
            className="focus-ring rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-dim"
          >
            Close
          </button>
        </div>
      </div>
    </div>
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
