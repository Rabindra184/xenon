import * as React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

/**
 * The picture beside the sign-in form: three devices streaming live, and a
 * 6s loop on the middle one — a tap on "Pay now", the selector failing, then
 * healing. Stands in for the reference's Spline scene, which fetched a
 * third-party asset on a pre-auth page. Purely decorative; motion lives in
 * auth.css and settles on the healed frame under prefers-reduced-motion.
 */
export function AuthHero() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-[360px] w-[420px] select-none">
      <div className="absolute left-0 top-12 z-10 -rotate-6">
        <Frame label="Pixel 8" delay="0s">
          <ChatScreen />
        </Frame>
      </div>
      <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2">
        <Frame label="iPhone 15" delay="-2s">
          <CheckoutScreen />
        </Frame>
      </div>
      <div className="absolute right-0 top-14 z-10 rotate-6">
        <Frame label="Galaxy S24" delay="-4s">
          <StatsScreen />
        </Frame>
      </div>

      <div className="absolute -bottom-3 left-1/2 z-30 h-8 w-[300px] -translate-x-1/2">
        <StoryChip motion="xe-story-fail" border="border-[var(--status-error-border)]">
          <XCircle className="h-3.5 w-3.5 text-[var(--red)]" />
          <span className="font-mono text-white/70">~pay_button</span>
          <span className="text-[var(--red)]">NoSuchElement</span>
        </StoryChip>
        <StoryChip motion="xe-story-heal" border="border-[var(--accent-border)]">
          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--green)]" />
          <span className="text-[var(--text)]">healed</span>
          <span className="font-mono text-white/50">text=&quot;Pay now&quot;</span>
        </StoryChip>
      </div>
    </div>
  );
}

function StoryChip({
  motion,
  border,
  children,
}: {
  /** The auth.css class that shows this chip during its part of the loop. */
  motion: string;
  border: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${motion} absolute inset-0 flex items-center justify-center`}>
      <div
        className={`flex items-center gap-2 whitespace-nowrap rounded-full border ${border} bg-[#0b100f]/90 px-3 py-1.5 text-[11px] shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur`}
      >
        {children}
      </div>
    </div>
  );
}

function Frame({
  label,
  delay,
  children,
}: {
  label: string;
  delay: string;
  children: React.ReactNode;
}) {
  return (
    <div className="xe-float" style={{ animationDelay: delay }}>
      <div className="relative h-[300px] w-[148px] overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-[#1a201f] to-[#0b0f0e] p-[6px] shadow-[0_30px_70px_rgba(0,0,0,0.6)]">
        <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[#0e1312]">
          <div className="mx-auto mt-1.5 h-1.5 w-10 rounded-full bg-black" />
          <div className="mt-2 flex items-center justify-between px-3">
            <span className="flex items-center gap-1 rounded-full bg-[var(--status-ready-bg)] px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-[var(--green)]">
              <span className="xe-pulse h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
              LIVE
            </span>
            <span className="font-mono text-[8px] text-white/35">{label}</span>
          </div>
          <div className="mt-2 px-2.5">{children}</div>
          <div
            className="xe-scan absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-[rgba(34,197,94,0.10)] to-transparent"
            style={{ animationDelay: delay }}
          />
        </div>
      </div>
    </div>
  );
}

const AVATARS = ['#f472b6', '#60a5fa', '#fbbf24', '#34d399', '#a78bfa'];

function ChatScreen() {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold text-white/80">Messages</div>
      <div className="space-y-2">
        {AVATARS.map((c, i) => (
          <div key={c} className="flex items-center gap-2">
            <span
              className="h-6 w-6 shrink-0 rounded-full"
              style={{ background: c, opacity: 0.85 }}
            />
            <div className="flex-1 space-y-1">
              <div
                className="h-1.5 rounded-full bg-white/25"
                style={{ width: `${50 + ((i * 17) % 40)}%` }}
              />
              <div
                className="h-1.5 rounded-full bg-white/10"
                style={{ width: `${70 - ((i * 11) % 30)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CheckoutScreen() {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold text-white/80">Checkout</div>
      <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-400/70 via-teal-500/50 to-sky-600/60" />
      <div className="mt-2.5 flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-1.5 w-16 rounded-full bg-white/30" />
          <div className="h-1.5 w-10 rounded-full bg-white/10" />
        </div>
        <span className="text-[11px] font-semibold text-white/85">$49</span>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="h-1.5 w-full rounded-full bg-white/10" />
        <div className="h-1.5 w-4/5 rounded-full bg-white/10" />
      </div>
      <div className="relative mt-4">
        <div className="xe-story-target grid h-8 place-items-center rounded-lg bg-[var(--green)] text-[10px] font-semibold text-black">
          Pay now
        </div>
        <span className="xe-story-ripple absolute left-1/2 top-1/2 -ml-3 -mt-3 h-6 w-6 rounded-full border-2 border-white/80" />
        <span className="xe-story-finger absolute left-1/2 top-1/2 -ml-2.5 -mt-2.5 h-5 w-5 rounded-full bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.6)]" />
      </div>
    </div>
  );
}

const BARS = [40, 65, 50, 85, 60, 95, 75];

function StatsScreen() {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold text-white/80">Revenue</div>
      <div className="text-[15px] font-bold text-white/90">$12.4k</div>
      <div className="text-[8px] text-[var(--green)]">▲ 18% this week</div>
      <div className="mt-3 flex h-24 items-end gap-1.5">
        {BARS.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-gradient-to-t from-sky-500/40 to-sky-400/80"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 w-3/4 rounded-full bg-white/10" />
        <div className="h-1.5 w-1/2 rounded-full bg-white/10" />
      </div>
    </div>
  );
}
