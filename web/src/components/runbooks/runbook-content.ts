/**
 * Runbook content keyed by failure category.
 *
 * Each entry gives testers concrete steps for a kind of session failure,
 * opened from the "Open runbook" link on the session page's "Why it failed"
 * card. Only categories the server writes have one (the failure analysis's,
 * and HUB_RESTART); failure-categories.spec.ts holds the keys to them, and
 * runbook-content.test.tsx holds every UI name they mention to what the
 * session page shows.
 *
 * Lookup is case-insensitive; the page also normalizes hyphen / underscore /
 * space variants. Categories with no runbook of their own fall back to the
 * `unknown` runbook.
 */

export interface RunbookContent {
  title: string;
  markdown: string;
}

export const RUNBOOKS: Record<string, RunbookContent> = {
  hub_restart: {
    title: 'Hub restart',
    markdown: `# Hub restart

The Xenon server restarted while this session was running. A session on one
of that server's own phones ran inside it, so it ended with the restart. A
session on a phone connected to another machine ends too if the server can't
pick it up again after the restart.

## Likely causes

- Someone restarted or updated the Xenon server.
- The server stopped unexpectedly and was started again.
- The computer running it restarted.

## What to do

1. Run the session again.
2. If restarts happen during test runs, ask whoever looks after the Xenon
   server to plan them outside test hours, and to find out why it stopped if
   nobody restarted it.
`,
  },
  timeout: {
    title: 'Timeout',
    markdown: `# Timeout

The failure reason or one of the session's last failed commands mentions a
timeout. Usually a command or a wait ran out of time, or the test sent no
command for longer than its \`newCommandTimeout\` and the session was ended.
A session the server lost contact with ends up here too.

## Likely causes

- A test step waited for an element that never appeared.
- The test paused, hung or stopped between commands for longer than
  \`newCommandTimeout\`.
- A slow phone or an unreliable network.
- A command that never returned, for example because of a driver bug.
- The server lost contact with the session.

## What to do

Raise \`newCommandTimeout\` only if the app really needs long pauses between
commands. Otherwise:

1. In the **Commands** tab, look at the last command before the failure. If
   it's a find, fix the selector or wait for the element explicitly.
2. On the **Devices** page, check that the phone is still connected and,
   where its card shows them, its battery and temperature: a hot or nearly
   flat phone slows down. They are the phone's latest readings, not the ones
   from the run.
3. If the same command times out run after run, report it against the test,
   or against the driver if the command clearly hung.
`,
  },
  unknown: {
    title: 'Unknown',
    markdown: `# Finding out why it failed

Xenon couldn't tell what kind of failure this was, or has no runbook for its
kind yet. These steps help with any failure.

## What to do

1. In **Why it failed**, read the **Reason**, the **First failed command** and,
   if there is one, the **AI analysis**.
2. In the **Commands** tab, tick **Errors only** to see every command that
   failed. **Device logs** shows what the phone and the app reported around
   the same time.
3. Run the session again and see whether it fails the same way.

If the same kind of failure keeps landing here, report it with a link to the
session, so it can get a runbook of its own.
`,
  },
};

/** The runbook's key for a category: "HUB_RESTART", "hub-restart" and "Hub Restart" are all `hub_restart`. */
export function runbookKey(rawCategory: string): string {
  return rawCategory
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

export function lookupRunbook(rawCategory: string | undefined | null): RunbookContent {
  if (!rawCategory) return RUNBOOKS.unknown;
  const key = runbookKey(rawCategory);
  // Own keys only: "constructor" is not a runbook.
  return Object.prototype.hasOwnProperty.call(RUNBOOKS, key) ? RUNBOOKS[key] : RUNBOOKS.unknown;
}
