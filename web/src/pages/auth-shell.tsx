import * as React from 'react';
import { Spotlight, SpotlightBeam } from '../components/ui/spotlight';
import { AuthHero } from './auth-hero';
import './auth.css';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2 bg-[var(--bg)] text-[var(--text)]">
      <aside className="relative hidden md:flex flex-col justify-center gap-10 overflow-hidden bg-black/[0.96] px-12 py-12 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px]">
        <SpotlightBeam className="-top-40 left-0 md:left-60 md:-top-20" />
        <Spotlight />

        <div className="relative z-10 xe-rise">
          <img
            src={`${import.meta.env.BASE_URL}logo.svg`}
            alt="Xenon"
            className="mb-8 h-8 w-auto object-contain"
          />
          <h2 className="bg-gradient-to-b from-neutral-50 to-neutral-400 bg-clip-text text-4xl font-bold leading-tight tracking-tight text-transparent lg:text-5xl">
            Your device lab,
            <br />
            live.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-neutral-400">
            Appium orchestration with self-healing selectors, real-time device streaming, and
            proof-pack recording — on hardware you own.
          </p>
        </div>

        <div className="relative z-10 xe-rise" style={{ animationDelay: '0.15s' }}>
          <AuthHero />
        </div>
      </aside>

      <main className="relative flex items-center justify-center overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 right-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.08),transparent_70%)]"
        />
        <div className="relative w-full max-w-sm px-6 xe-rise" style={{ animationDelay: '0.1s' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
