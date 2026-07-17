import * as React from 'react';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2 bg-[var(--bg)] text-[var(--text)]">
      <aside className="relative hidden md:flex flex-col justify-center px-12 overflow-hidden bg-gradient-to-br from-[#0a0e1a] via-[#131a2e] to-[#1a2548]">
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(circle at 80% 20%, rgba(99,102,241,0.18), transparent 60%)' }} />
        <div className="relative">
          <img
            src={`${import.meta.env.BASE_URL}logo.svg`}
            alt="Xenon Logo"
            className="h-8 w-auto object-contain mb-4"
          />
          <div className="text-3xl font-semibold tracking-tight mb-2">Xenon</div>
          <p className="text-sm text-[var(--text-dim)] max-w-sm leading-relaxed mb-8">
            Enterprise-grade Appium device lab orchestration with AI self-healing,
            live device streaming, and proof-pack recording.
          </p>
          <div className="flex flex-wrap gap-2 max-w-sm">
            {['Self-healing tests', 'Live device streaming', 'Hub-node scaling', 'Proof-pack recording'].map((t) => (
              <span key={t} className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[var(--text-muted)]">
                {t}
              </span>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center">
        <div className="w-full max-w-sm px-6">{children}</div>
      </main>
    </div>
  );
}
