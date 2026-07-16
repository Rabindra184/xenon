import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LaunchSpec, Profile } from '@shared/types';
import { Copy, Download, X } from 'lucide-react';
import { toast } from './ui/toastStore';

interface Props {
  profile: Profile;
  onClose: () => void;
}

// A dry-run: shows the exact command, environment variable NAMES (never values),
// and the fully-resolved Appium config YAML that Start would use. Nothing here
// reveals a secret value — only which keys are injected.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

export function LaunchPreview({ profile, onClose }: Props) {
  const [spec, setSpec] = useState<LaunchSpec | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.xenon.server.launchPreview(profile).then(setSpec);
  }, [profile]);

  // Modal focus management: move focus in on open, keep Tab inside the dialog,
  // and hand focus back to whatever opened it on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null
      );
      if (!nodes.length) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and pull focus back in if it escaped the dialog.
      if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Launch preview"
        tabIndex={-1}
        className="focus:outline-none flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
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
                  onClick={() => {
                    void navigator.clipboard.writeText(spec.configYaml);
                    toast('Config copied');
                  }}
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
            onClick={() => window.xenon.profiles.exportConfigYaml(profile).then((ok) => ok && toast('Config saved'))}
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
