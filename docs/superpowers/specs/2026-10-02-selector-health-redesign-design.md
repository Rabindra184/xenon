# Selector Health: a worklist with a side panel

Date: 2026-10-02
Status: design agreed in conversation, section by section (layout B, members
may mark fixed and mute, no cost anywhere). The user asked to go ahead and
complete it without stopping for the written review.

## Who it is for, and what done means

- **Mainly test engineers, then QA leads.** A team sees whether its tests are
  getting more or less reliable, then works through the selectors breaking
  most and fixes each one with the suggested replacement.
- **Done means:**
  - selectors and suggested fixes are readable at 1280–1440 px;
  - the To fix, Being verified, Fixed and Muted lists are correct;
  - there's a trend over time;
  - people see only the actions they may take, and every action is recorded
    with its person;
  - plain words, both themes, the dashboard's own dialogs.

## What is wrong today

Seen at 1280 px with sample data (the lab has no heals), or read in the code:

1. The table's headers sit about 70 px right of their columns.
2. The selector is cut to about 25 characters, the suggested fix to about 10.
3. The list opens the detail page without the selector's strategy. The detail
   page then shows an "append ?strategy=<name> to the URL" tip on every visit
   and never shows the selector's status or its actions.
4. Pending and Resolved lose selectors. The server takes the top 50 by heal
   count before splitting by status, and a fixed selector that stops healing
   falls out of the time window, so it leaves Resolved.
5. Mark fixed, Mute and Send digest are admin-only on the server, but every
   user sees them.
6. Actions record the person by API key. A dashboard user has none, so every
   dashboard action is saved with an empty actor.
7. The cost figure multiplies heal counts by fixed prices in the code, whatever
   model runs, OCR included. With a local model it is simply wrong.
8. Dated: `window.confirm`, five controls per row, icon-only header buttons,
   six numbers and no trend, no search, tab counts only on the open tab, a
   silent 5,000-heal cap, and technical words ("Brittle selectors",
   "Avg conf.", "tuple").

## The page

### Top

- **Header:** title, one plain line ("Selectors your tests could only find with
  self-healing. Fix the ones that heal most."), the period (7, 30 or 90 days,
  which sets everything on the page), and "Send digest" as a labelled button
  for admins. No Refresh button: the page follows the live events.
- **Four numbers**, each compared with the period before, in words:
  1. **Selectors that needed healing** (distinct selectors healed in the
     period; today's "Brittle selectors").
  2. **Heals.**
  3. **Sessions affected.**
  4. **Time spent healing:** the total duration of the commands that needed
     healing. Xenon already records every command's duration.

  Notes read "2 fewer than the 30 days before", "39% more than the 30 days
  before", "Same as the 30 days before" or "None the 30 days before". Fewer is
  green, more is red.
- **Trend:** heals per day, and a second line for heals that used AI (Visual AI
  and LLM: the slowest, least certain heals). Hovering shows the date and both
  values. It reuses the Performance panel's `LineChart`, which gains a
  `formatTime` prop for dates.
- **No cost anywhere** (see Server).

### The list

- **Tabs, each with its count:** To fix, Being verified, Fixed, Muted.
  - **To fix:** selectors healed in the period that aren't being verified,
    fixed or muted.
  - **Being verified:** marked fixed, waiting for 3 clean builds. Not tied to
    the period.
  - **Fixed:** verified within the period.
  - **Muted:** muted now. Not tied to the period.
- **To fix columns:** Selector (its type as a small label above it, the
  selector in monospace wrapping to two lines, full text on hover), Heals (with
  sessions under it), Last healed, Healed by (the method most heals used), and
  Suggested fix (its type and "82% of heals" above it, wrapping to two lines).
  A selector that broke again after being fixed says so.
- **Other tabs' columns:**
  - Being verified: "2 of 3 clean builds", marked fixed by whom and when.
  - Fixed: when it was verified.
  - Muted: muted by whom, when, and the reason.
- **Toolbar:** search (the selector, and on To fix the suggested fix too).
  Platform, healing method and sort apply to To fix only: they describe heals,
  and the other tabs list a status. Sort: most heals, most recent, or most time
  spent healing. (Most sessions was in the chat mockup; counting distinct
  sessions per selector can't be sorted on in the database, while time spent
  can, and it says more.) The other tabs sort by their own date, newest first.
- **No buttons in rows.** Clicking a row, or Enter on it, opens the panel.
- **Paging:** 50 per page, "1–50 of 312", Previous and Next.
- **The address holds the view:** tab, period, search, filters, sort, page and
  the open selector, so a view or one selector can be bookmarked or shared.
- **Broke-again banner:** the live banner stays, reworded ("A selector you
  fixed broke again"), and links to To fix.
- **Empty states** name the tab ("Nothing to fix in the last 30 days") in plain
  words, with no API docs link.

### The side panel

- **Opening:** a row opens a 480 px panel on the right. The list stays,
  narrowed to Selector, Heals and Last healed. ↑ and ↓ move to the previous or
  next selector on the page, Esc closes and returns focus to the row. A link
  button copies the page address. `/selector-health/detail?value=…&strategy=…`
  redirects to the panel, and the detail page is retired.
- **Contents, top to bottom:**
  1. The selector's type and full text with a copy button, its status (To fix,
     "Being verified, 2 of 3 clean builds", Fixed, Muted), and the actions.
  2. **Actions:** To fix: Mark fixed, Mute. Being verified: Cancel
     verification, Mute. Fixed: Mute. Muted: Unmute. Mark fixed and Cancel
     verification confirm in the dashboard's `Modal`; Mute asks for an
     optional reason (up to 500 characters). Unmute acts at once, with a
     toast. Only shown to people who may act.
  3. **Suggested fix:** every replacement the healer landed on in the period,
     most used first, with its type, share of heals, methods and average
     confidence. The first is highlighted. Each has "Copy as" (JavaScript,
     Java, Python, C#, Ruby), the existing `CopyButton` given a strategy and
     value.
  4. **Numbers:** heals, sessions and time spent healing in the period, and a
     small heals-per-day chart.
  5. **Where it happens:** platforms, builds (by name) and devices, with counts,
     top 5 each.
  6. **Recent heals:** the latest 20, with when, device, method, confidence and
     the element found, each linking to its session (`/builds/<build or
     none>/sessions/<id>`, as the Builds page links).
  7. **Activity:** who marked it fixed, cancelled, muted (with the reason) or
     unmuted it, when it was verified, and when it broke again; newest first,
     the latest 50.
- A selector with no heals in the period says so in place of sections 3–6.

### Healing methods

The tier names stay (people use them in `healingTiers`), each with a plain
explanation on hover:

| Method | Explanation |
|---|---|
| Resilio | Found it from its saved fingerprint |
| Native | Found it again with the original selector |
| Fuzzy XML | Found the closest match in the screen's structure |
| OCR | Found it by reading the text on screen |
| Visual AI | Found it in a screenshot with AI |
| LLM | Asked a language model to find it |

## Server

### `SelectorEvent` (new table)

```prisma
model SelectorEvent {
  id                String   @id @default(uuid())
  original_strategy String
  original_selector String
  action            String   // marked_fixed | verification_cancelled | verified | broke_again | muted | unmuted
  user_id           String?  // the person; null for Xenon's own transitions
  reason            String?  // mute only
  createdAt         DateTime @default(now())

  @@index([original_strategy, original_selector, createdAt])
}
```

- No foreign key to `SelectorState` (unmute and cancel can delete the state
  row; its history stays) or to `User` (a deleted user's actions stay, shown
  without a name).
- `SelectorStateService` writes the event and the status change in one
  interactive transaction. `SelectorVerificationJob` writes `verified`, and
  the heal hook `broke_again`.
- **The person is `resolveActor(req).userId`.** `auth-disabled` and unknown
  ids show no name. The old `*_by_api_key` columns are still written, for
  older readers.

### Endpoints

- **`GET /healing/selectors`** (new) feeds the list.
  - Query: `tab` (fix, verifying, fixed, muted), `days`, `q`, `platform`,
    `method`, `sort` (heals, recent, time), `page`, `pageSize` (≤ 100).
  - Answer: `{ tab, days, page, pageSize, total, counts: { fix, verifying,
    fixed, muted }, canAct, items }`. Each item has the selector and strategy,
    heals, sessions, last healed, time spent, top method, the top suggestion
    with its share, and its state (status, clean builds, who and when fixed or
    muted, the mute reason, how often it broke again).
  - To fix groups heal rows by selector in the database (`groupBy`), so no
    heal is left uncounted, then removes selectors with another status and
    pages in memory. Sessions, top method and top suggestion are grouped for
    the page's 50 only.
  - The other tabs start from `SelectorState` rows of that status.
  - Counts follow the period, not the search or filters.
- **`GET /healing/selectors/detail?strategy=&selector=&days=&tz=`** (new)
  feeds the panel: everything in its sections, `canAct`, state and activity.
  It always uses strategy and value.
- **`GET /healing/summary`** gains `timeSpentMs` (current and prior) and
  `trend: [{ t, heals, aiHeals }]`, one per day of the period, with zeros.
  Days follow the browser's clock: the client sends `tz`, its offset from UTC
  in minutes. The rows the summary already loads give the trend, so there is
  no trend endpoint.
- **`POST /healing/selector/state`** opens to members: `roleGuard('MEMBER')`
  and `scopeGuard(['sessions'])` (an admin key passes, `admin` implying every
  scope). It takes an optional `reason` for `mute`, and records the person.
- **Unchanged** apart from cost: `/healing/hotspots`, the CI gate
  (`/healing/hotspots/violations`), `/healing/selector` (the retired page's
  feed, kept for other callers), `/healing/selector-health`, the digest's
  choice of selectors, and the two state reads.

### Who sees what

- A selector is **visible** to a caller who can see at least one session where
  it healed, at any time (`visibleSessionWhere`). An admin, or a server with
  auth disabled, sees every selector.
- The new list's tabs, the panel and the actions show or accept only visible
  selectors. For anything else the panel and the action answer
  `404 { error: 'not_found', message: 'Selector not found' }`, the same as for
  a selector that doesn't exist.
- `canAct` is true for a caller with the `sessions` or `admin` scope. A
  dashboard member has `sessions`; an API key has it only if it was given it.
- Status and activity stay one lab-wide row per selector: a selector's fix or
  mute applies to every team whose tests use it, as today.
- The old `/healing/state/muted` keeps answering every muted row; the new
  Muted tab doesn't use it.

### No cost

`TIER_COST_USD` and `estimateCost` are removed, with `estCostUsd` in the
summary, hotspots, CI gate and detail answers, the digest's payload and its
"est. $…" line, and the API docs. The CHANGELOG of the next release says so:
any client reading `estCostUsd` gets `undefined`.

## Wording and look

- Plain words; no internal terms (the rule in memory: no tool names, setting
  keys or server topology).
- Tailwind classes and role tokens; `selector-health.css` is retired, and its
  colour-literal baseline entry removed.
- Both themes. Laid out for 1280–1440 px, with the panel open as well.
- Sentence case, no `window.confirm`.

## Out of scope

- Bulk actions and CSV export.
- Scoping the `selector_*` socket events by team. Today they go to every
  dashboard, as before.
- Per-team selector status (a fix or mute stays lab-wide).
- Measuring healing time apart from the command's own duration.

## Testing

- **Server, real queries** (the team-visibility integration pattern: seeded
  users, teams, phones, sessions and heals):
  - To fix counts with no cap on heals, excludes other statuses, searches
    selector and suggestion, filters by platform and method, sorts three ways,
    pages, and returns all four counts;
  - Being verified, Fixed (by period) and Muted come from status, including a
    selector with no heal in the period;
  - a member sees only visible selectors in every tab, and gets 404 on another
    team's selector in the panel and the action;
  - the panel's sections, recent heals, activity with names;
  - the summary's time spent and trend days, in a given offset;
  - actions: a member may act, a `read`-only key may not, the person and the
    mute reason are recorded, a reason over 500 characters is refused;
  - no `estCostUsd` anywhere; the digest line has no cost.
- **Server, units:** `SelectorStateService` writes one event per transition in
  the transaction; the verification job writes `verified`, the heal hook
  `broke_again`.
- **Web (vitest):** the address round-trip, the formatters and comparison
  notes, the summary and trend, the list's tabs, columns, compact mode, search
  and paging, the panel's sections, dialogs, keyboard, and actions hidden
  without `canAct`; a no-jargon check over every state.
- **Viewport overflow spec:** Selector Health with the panel closed and open,
  mocked with long selectors.
- **Live:** the scratch server, with heals from a real session on the S9+ where
  they can be produced, seeded rows otherwise (and said so).
