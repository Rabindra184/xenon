import * as React from 'react';
import { MonitorSmartphone, Network, ShieldCheck } from 'lucide-react';
import { Logo } from '../components/ui/Logo';

// Each line is something the product does today. No figures (fps, latency)
// that vary by device and would go stale on a page people see every day.
const CAPABILITIES = [
  {
    icon: ShieldCheck,
    title: 'Self-healing selectors',
    body: 'Broken locators recover through six escalating tiers before a test fails.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Live Android & iOS devices',
    body: 'Watch, drive and record real devices from the browser.',
  },
  {
    icon: Network,
    title: 'Hub–node scaling',
    body: 'One hub orchestrates device labs across machines.',
  },
];

/**
 * Layout shared by sign-in, forgot-password and reset-password.
 *
 * Deliberately still. The people on this page are existing users signing in
 * daily, so it is built for trust and speed rather than to sell: no looping
 * animation, no invented product data, no blur layers (expensive on thin
 * clients and remote-desktop sessions), and nothing fetched from a third
 * party before authentication. Every text colour clears WCAG AA (4.5:1).
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-[var(--bg)] text-[var(--text)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden border-r border-[rgb(var(--rgb-fg)/0.06)] bg-[var(--surface-sunken)] md:flex md:flex-col">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_0%_0%,rgb(var(--rgb-accent)/0.14),transparent_60%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(var(--rgb-white)/0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--rgb-white)/0.03)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />

        <div className="relative flex flex-1 flex-col justify-between px-12 py-10">
          <Logo className="h-8 w-auto self-start object-contain" />

          <div className="max-w-md">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">
              Your device lab,
              <br />
              <span className="text-[var(--color-accent)]">under control.</span>
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">
              Appium orchestration for the devices you own — with self-healing tests, live streaming
              and recordable proof of what ran.
            </p>

            <ul className="mt-10 space-y-6">
              {CAPABILITIES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-subtle)]">
                    <Icon className="h-4 w-4 text-[var(--color-accent)]" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-[var(--text)]">{title}</div>
                    <div className="mt-0.5 text-sm text-[var(--text-muted)]">{body}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* One footer, in the panel. Not "your data stays on your hardware":
              the LLM healing tier sends page source to an external provider
              when one is configured. */}
          <footer className="flex items-center justify-between border-t border-[rgb(var(--rgb-fg)/0.06)] pt-5 text-xs text-[var(--text-muted)]">
            <span>Xenon v{__XENON_VERSION__} · Self-hosted device lab</span>
            <a
              href={`${import.meta.env.BASE_URL}api-docs`}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
            >
              API docs
            </a>
          </footer>
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[400px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-8 py-9 shadow-[var(--shadow-lg)]">
          {children}
        </div>
      </main>
    </div>
  );
}
