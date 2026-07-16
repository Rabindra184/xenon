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
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold">Launch preview — dry run</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        {!spec ? (
          <div className="p-6 text-sm text-slate-400">Building preview…</div>
        ) : (
          <div className="space-y-4 overflow-auto p-5">
            <Section title="Command">
              <code className="block break-all rounded-md bg-slate-900 p-3 font-mono text-xs text-emerald-300">
                {spec.command} {spec.args.join(' ')}
              </code>
            </Section>

            <Section title="APPIUM_HOME">
              <code className="block break-all text-xs text-slate-600 dark:text-slate-300">{spec.appiumHome}</code>
            </Section>

            <Section title={`Environment variables (${spec.envKeys.length}) — names only`}>
              <div className="flex flex-wrap gap-1.5">
                {spec.envKeys.map((k) => (
                  <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">
                    {k}
                  </span>
                ))}
              </div>
            </Section>

            <Section title="Generated Appium config (server.plugin.xenon)">
              <div className="relative">
                <pre className="max-h-72 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                  {spec.configYaml}
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(spec.configYaml)}
                  className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-[11px] text-white"
                >
                  <Copy size={11} /> Copy
                </button>
              </div>
            </Section>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <button
            onClick={() => window.xenon.profiles.exportConfigYaml(profile)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
          >
            <Download size={14} /> Save config…
          </button>
          <button onClick={onClose} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">
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
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}
