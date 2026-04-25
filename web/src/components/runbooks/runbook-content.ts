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

> TODO: document remediation steps for hub restart failures.

In the meantime: re-trigger the affected sessions from your test runner. If
restarts repeat, check \`/var/log/xenon-hub.log\` and the supervisor's
restart history for a root cause before redeploying.

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

> TODO: document remediation steps for timeout failures.

Check the last command in **Text Logs** to see what was in flight when the
timeout fired. If the same command consistently times out across runs, file a
bug against the test (or against the driver if the call obviously stalled).
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

> TODO: document remediation steps for infrastructure failures.

Cross-reference the **Device Logs** tab on this session and the node's own
process metrics around the failure timestamp. Restart the affected node if
its agent's heartbeat is missing.
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

> TODO: improve auto-categorization so this runbook is rarely used.
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
