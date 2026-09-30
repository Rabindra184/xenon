/**
 * What holds a busy device: this server's own `session_id`, else, for a
 * node's phone on a hub, the preview hold its node reports (`nodeHold`). The
 * hub keeps them apart because `session_id` is its own; the dashboard reads
 * either the same way. A manual lock is `manual_<userId>_<udid>` in both.
 */
export function holdOf(row: {
  session_id?: string | null;
  nodeHold?: string | null;
}): string | null {
  return row.session_id || row.nodeHold || null;
}
