import * as React from 'react';
import { Sparkles } from 'lucide-react';

type Phone = {
  label: string;
  /** Tailwind classes positioning and tilting this frame. */
  place: string;
  delay: string;
  rows: number[];
};

const PHONES: Phone[] = [
  { label: 'Pixel 8', place: 'left-0 top-10 -rotate-6 z-10', delay: '0s', rows: [70, 45, 85, 55] },
  {
    label: 'iPhone 15',
    place: 'left-1/2 -translate-x-1/2 top-0 z-20',
    delay: '-2s',
    rows: [60, 90, 40, 75],
  },
  {
    label: 'Galaxy S24',
    place: 'right-0 top-12 rotate-6 z-10',
    delay: '-4s',
    rows: [80, 50, 65, 35],
  },
];

/**
 * The picture beside the sign-in form: a few devices streaming live, one
 * selector being healed. Stands in for the reference's Spline scene, which
 * fetched a third-party asset on a pre-auth page. Purely decorative.
 */
export function AuthHero() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-[340px] w-[400px] select-none">
      {PHONES.map((p) => (
        <div key={p.label} className={`absolute ${p.place}`}>
          <div className="xe-float" style={{ animationDelay: p.delay }}>
            <div className="relative h-[300px] w-[148px] overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-[#161b1a] to-[#0b0f0e] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
              <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[#0d1211]">
                <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-white/10" />
                <div className="mt-3 flex items-center justify-between px-3">
                  <span className="flex items-center gap-1 rounded-full bg-[var(--status-ready-bg)] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[var(--green)]">
                    <span className="xe-pulse h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
                    LIVE
                  </span>
                  <span className="font-mono text-[9px] text-white/35">{p.label}</span>
                </div>
                <div className="mt-4 space-y-2.5 px-3">
                  <div className="h-16 rounded-lg bg-gradient-to-br from-white/[0.07] to-white/[0.02]" />
                  {p.rows.map((w, i) => (
                    <div
                      key={i}
                      className="h-2 rounded-full bg-white/[0.06]"
                      style={{ width: `${w}%` }}
                    />
                  ))}
                  <div className="mt-3 h-7 rounded-md border border-[var(--accent-border)] bg-[var(--accent-subtle)]" />
                </div>
                <div
                  className="xe-scan absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-[rgba(34,197,94,0.12)] to-transparent"
                  style={{ animationDelay: p.delay }}
                />
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className="absolute -bottom-2 left-1/2 z-30 -translate-x-1/2">
        <div className="xe-float" style={{ animationDelay: '-3s' }}>
          <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--accent-border)] bg-[#0d1211]/90 px-3 py-1.5 text-[11px] text-[var(--text-muted)] shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-[var(--green)]" />
            <span className="text-[var(--text)]">selector healed</span>
            <span className="font-mono text-white/40">· 142 ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}
