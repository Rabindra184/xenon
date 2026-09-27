/** "5 Jan 2026, 10:00": when a recording started, in the viewer's locale. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
