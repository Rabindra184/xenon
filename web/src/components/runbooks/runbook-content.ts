/**
 * Stub runbook content keyed by failure category.
 *
 * Each entry is a one- to two-paragraph placeholder. Real remediation guidance
 * is a separate doc-writing task — these stubs exist so the "Open runbook"
 * link from the Failure Summary card lands somewhere useful instead of 404.
 *
 * Lookup is case-insensitive; the page also normalizes hyphen / underscore /
 * space variants. Unknown categories fall back to the `unknown` runbook.
 */

export interface RunbookContent {
  title: string;
  markdown: string;
}

export const RUNBOOKS: Record<string, RunbookContent> = {
  hub_restart: {
    title: 'Hub Restart',
    markdown: `# Hub Restart

A session was terminated because the Xenon hub restarted while the test was
mid-flight. The agent's connection was lost and the session was reaped by the
heartbeat watchdog.

## Likely causes

- Operator triggered a manual restart from the dashboard.
- Process supervisor restarted the hub after a crash or a deploy.
- The host running the hub was rebooted or hibernated.

## Remediation

1. Re-trigger the affected sessions from your test runner — the device was
   released cleanly back into the pool, so a retry should land on a healthy
   hub.
2. Check \`/var/log/xenon-hub.log\` and the process supervisor's restart
   history around the failure timestamp to confirm whether this was a manual
   restart, a crash, or a deploy.
3. If restarts are frequent or unplanned, correlate them with recent deploys
   and coordinate a maintenance window — any session in flight during a hub
   restart is always killed, there's no graceful drain.

## Related

- Session lifecycle: see \`SessionLifecycleService.ts\`
- Heartbeat watchdog: see \`SessionManager.checkHeartbeat\`
`,
  },
  timeout: {
    title: 'Timeout',
    markdown: `# Timeout

The session hit a wall-clock timeout — either the per-command \`newCommandTimeout\`
or the session-level deadline. Xenon force-killed the session so its device
could be released back into the pool.

## Likely causes

- Test step waited indefinitely on a missing element.
- Slow device or flaky network.
- A driver bug caused the WebDriver call to never return.

## Remediation

Increase \`newCommandTimeout\` only if the app legitimately needs long idle
gaps. Otherwise:

1. Check the last command in **Text Logs** — if it's a find, fix the selector
   or add an explicit wait.
2. Verify the device wasn't thermally throttled or offline during the run
   (**Device health** badges).
3. If the same command times out across runs, file a bug against the test —
   or against the driver if the call obviously stalled.
`,
  },
  infrastructure: {
    title: 'Infrastructure',
    markdown: `# Infrastructure

The session failed because of a problem outside the test code — typically the
node, the device, or the network underneath them.

## Likely causes

- Node lost its connection to the hub.
- ADB / WDA daemon crashed on the node.
- Device went offline mid-session.
- Backing storage / Prisma DB hiccup.

## Remediation

1. Cross-reference the **Device Logs** tab on this session with the node's
   own process metrics around the failure timestamp to see which layer
   dropped — hub connection, daemon, device, or storage.
2. If the node's heartbeat is missing, restart its Xenon agent process; if
   ADB/WDA crashed, bounce the daemon first.
3. If the device shows offline in the device list, reseat or reconnect it
   (USB or Wi-Fi debugging) and confirm it re-enumerates before re-queuing
   sessions on it.
4. For repeated storage/DB hiccups, check disk space and the Prisma
   connection pool limits on the hub host.
`,
  },
  unknown: {
    title: 'Unknown',
    markdown: `# Unknown failure category

We weren't able to attribute this failure to a known bucket. The session has
\`failure_category=null\` (or a category we don't have a runbook for yet).

## What to do

1. Open the **Failure summary** card for the raw \`failure_reason\` and the
   first error log entry.
2. If you can identify a clear category (timeout, hub restart, node outage,
   etc.), file a follow-up to add the right \`failure_category\` mapping in
   \`SessionLifecycleService\`.
3. For one-off oddities, re-run the session and watch for a pattern.

If you keep landing on this fallback for the same kind of failure, that's a
signal worth reporting — adding the right \`failure_category\` mapping
upstream means future occurrences get a real runbook instead of this one.
`,
  },
};

export function lookupRunbook(rawCategory: string | undefined | null): RunbookContent {
  if (!rawCategory) return RUNBOOKS.unknown;
  const key = rawCategory
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_'); // tolerate "hub-restart" / "Hub Restart"
  return RUNBOOKS[key] ?? RUNBOOKS.unknown;
}
