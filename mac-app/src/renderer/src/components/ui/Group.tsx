import { useId, type ReactNode } from 'react';

/**
 * A card with a heading, for rows that belong together. It is a labelled
 * region: a screen reader can list the groups on a screen by their titles.
 * Rows go inside and are separated by hairlines; they keep their own height
 * (at least 32 px) and need no side padding.
 */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-line bg-surface">
      <h2 id={headingId} className="border-b border-line px-4 py-2 text-sm font-semibold text-ink">
        {title}
      </h2>
      <div className="divide-y divide-line px-4">{children}</div>
    </section>
  );
}
