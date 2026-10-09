import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from 'lucide-react';

export type BannerTone = 'ok' | 'attention' | 'info' | 'danger';

// The border, tint and icon follow the status colours. The words stay in the
// ordinary text colour, so they read at full contrast in both themes.
const TONES: Record<BannerTone, { Icon: LucideIcon; icon: string; box: string }> = {
  ok: { Icon: CheckCircle2, icon: 'text-ok', box: 'border-status-ready-border bg-status-ready-bg' },
  attention: { Icon: AlertTriangle, icon: 'text-warn', box: 'border-status-busy-border bg-status-busy-bg' },
  info: { Icon: Info, icon: 'text-info', box: 'border-status-reserved-border bg-status-reserved-bg' },
  danger: { Icon: OctagonAlert, icon: 'text-danger', box: 'border-status-error-border bg-status-error-bg' }
};

/**
 * A message that stays on the screen, in a tinted box with an icon: what
 * happened, and what to do (`action`). A danger banner is announced at once
 * (role alert); the others are announced politely (role status). A banner that
 * comes and goes inside a live region of the caller's, which is on the page
 * before it (a region that arrives holding its words may not be announced),
 * passes `announce={false}` and has no role of its own.
 */
export function Banner({
  tone,
  title,
  action,
  announce = true,
  children
}: {
  tone: BannerTone;
  title?: string;
  action?: ReactNode;
  announce?: boolean;
  children: ReactNode;
}) {
  const { Icon, icon, box } = TONES[tone];
  return (
    <div
      role={announce ? (tone === 'danger' ? 'alert' : 'status') : undefined}
      className={`flex min-h-8 items-start gap-3 rounded-lg border px-3 py-2 ${box}`}
    >
      <Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1 text-sm text-ink">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
