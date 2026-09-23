import * as React from 'react';
import { Network, Smartphone, Wand2 } from 'lucide-react';
import { Spotlight, SpotlightBeam } from '../components/ui/spotlight';
import { AuthHero } from './auth-hero';
import './auth.css';

// Only claims the product can back up — no throughput numbers that vary by
// device and would go stale.
const FACTS = [
  { icon: Wand2, label: '6-tier self-healing' },
  { icon: Smartphone, label: 'Android & iOS' },
  { icon: Network, label: 'Hub–node scaling' },
];

/**
 * Layout shared by the sign-in, forgot-password and reset-password pages:
 * one continuous canvas (grid, aurora, light beam, pointer glow) with the
 * product story on the left and the page's form in a glass card on the right.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    // overflow-clip, not overflow-hidden: a hidden box is still scrollable
    // from script, and autofocusing the email field scrolled it 114px
    // sideways at 1280px, shifting the whole page left.
    <div className="relative min-h-screen w-full overflow-clip bg-[#050807] text-[var(--text)]">
      <Backdrop />
      <Spotlight size={520} />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-10">
        <header className="flex items-center pt-8 xe-rise">
          <img
            src={`${import.meta.env.BASE_URL}logo.svg`}
            alt="Xenon"
            className="h-8 w-auto object-contain"
          />
        </header>

        <div className="grid flex-1 grid-cols-1 items-center gap-12 py-6 md:grid-cols-[1.15fr_1fr]">
          <section className="hidden md:block xe-rise" style={{ animationDelay: '0.05s' }}>
            <h2 className="text-5xl font-bold leading-[1.05] tracking-tight">
              <span className="bg-gradient-to-b from-neutral-50 to-neutral-400 bg-clip-text text-transparent">
                Your device lab,
              </span>
              <br />
              <span className="bg-gradient-to-r from-[#4ade80] via-[#22c55e] to-[#14b8a6] bg-clip-text text-transparent">
                live.
              </span>
              <span className="xe-pulse ml-2 inline-block h-3 w-3 rounded-full bg-[var(--green)] align-middle shadow-[0_0_16px_rgba(34,197,94,0.8)]" />
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-neutral-400">
              Appium orchestration with self-healing selectors, real-time device streaming, and
              proof-pack recording — on hardware you own.
            </p>

            <div className="mt-8">
              <AuthHero />
            </div>

            <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-neutral-400">
              {FACTS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-[var(--green)]" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </section>

          <main
            className="flex justify-center md:justify-end xe-rise"
            style={{ animationDelay: '0.12s' }}
          >
            <GlassCard>{children}</GlassCard>
          </main>
        </div>

        <footer className="flex items-center justify-between border-t border-white/5 py-5 text-[11px] text-neutral-500">
          <span>Xenon v{__XENON_VERSION__}</span>
          <a
            href={`${import.meta.env.BASE_URL}api-docs`}
            target="_blank"
            rel="noreferrer"
            className="text-neutral-500 transition-colors hover:text-[var(--text)]"
          >
            API docs
          </a>
        </footer>
      </div>
    </div>
  );
}

function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_80%_70%_at_40%_40%,black,transparent)]" />
      <div className="xe-aurora absolute -left-40 top-1/4 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.16),transparent_65%)] blur-2xl" />
      <div
        className="xe-aurora absolute -right-32 -top-24 h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle,rgba(20,184,166,0.12),transparent_65%)] blur-2xl"
        style={{ animationDelay: '-9s' }}
      />
      <SpotlightBeam className="-top-40 left-0 md:-top-20 md:left-60" />
    </div>
  );
}

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full max-w-[400px]">
      <div
        aria-hidden="true"
        className="absolute -inset-8 rounded-[40px] bg-[radial-gradient(ellipse_at_top,rgba(34,197,94,0.14),transparent_70%)] blur-2xl"
      />
      <div className="relative rounded-2xl bg-gradient-to-b from-[rgba(34,197,94,0.45)] via-white/10 to-white/[0.04] p-px shadow-[0_40px_100px_-20px_rgba(0,0,0,0.85)]">
        <div className="rounded-[15px] bg-[#0b0f0e]/80 px-8 py-9 backdrop-blur-xl">{children}</div>
      </div>
    </div>
  );
}
