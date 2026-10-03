# Device control Logs tab redesign: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the device control Logs tab fits on one toolbar row, shows one line
per record at 720 px and wider with errors and warnings visible at a glance,
lets you act on a line (details, copy, show or hide its tag or app), keeps
your reading place while paused, and stays smooth with a full 5,000-line
buffer.

**Architecture:** `LogcatView` stays the parent and keeps the one source of
truth (the filter text), the stream (`useLogcatStream`, unchanged), recording,
following and selection. It is split into `LogToolbar`, `LevelBar`, `LogList`
(a `@tanstack/react-virtual` list that renders only the rows on screen),
`LogRow` and `LogDetails`, plus four pure modules: `levelCounts`,
`logSelection`, `findHighlight` and `logFormat`. The filter grammar gains
`-tag:` / `-package:` exclusions and two writers, `withTerm` and
`withExclusion`, for the details panel's buttons.

**Tech Stack:** React 17.0.2, TypeScript 4.9 (target ES5: no `for…of` over a
`Set`, no spreading one), Vite 5, Vitest 1.6 + jsdom 24, Testing Library 11,
`@tanstack/react-virtual` ^3.14 (installs `virtual-core` 3.17), Playwright 1.61
for the viewport spec.

**Spec:** `docs/superpowers/specs/2026-10-03-logs-tab-redesign-design.md`

## Global Constraints

- Branch `feat/logs-tab-redesign`. Browser only: no change to `src/`,
  `schema.json` or Prisma. Unchanged files: `useLogcatStream.ts`,
  `logcatRecording.ts`, `iosSourceFilter.ts`, `tagColor.ts`.
- New dependency: `@tanstack/react-virtual` ^3.14 in `web/package.json` only,
  installed with npm inside `web/` so `web/package-lock.json` updates.
- Copy is for testers: sentence case, plain words. Never on screen: "logcat",
  "os_trace", "adb", "go-ios", "WebSocket", setting keys. The tab label "Logs"
  stays. Exact strings this plan fixes are quoted in the task that uses them.
- Colours: role tokens (`--color-info`, `--color-danger`, `--color-warning`,
  `--color-highlight`, `--color-focus-ring`, `--text`, `--text-muted`,
  `--border`, …) and `color-mix(in srgb, var(--role) N%, transparent)` tints;
  neutral washes `rgb(var(--rgb-fg) / A)`. No hex or `rgba()` anywhere. The
  rows stay a `theme-dark` island. Nothing on this tab is filled green.
- Layout: `min-width` container and media queries only. The panel is 450 to
  1,200 px wide (954 at 1440, about 794 at 1280, 450 with a landscape phone).
  The one-line row layout starts at a 720 px panel (`@container`).
- Sizes: buffer 5,000 lines (the hook's `CLIENT_BUFFER`); follow slack 24 px
  (`FOLLOW_SLACK_PX`); a scroll counts as the user's for 1,000 ms after a
  wheel, touch, scroll key or scrollbar press (`USER_INTENT_MS`); row estimate
  20 px one-line, 38 px two-line; overscan 10; details panel at most 40% of
  the list's height.
- Numbers on screen use `formatCount` (`toLocaleString('en-US')`, "2,629").
- Tests: hooks only inside a `describe`. jsdom has no `ResizeObserver` and no
  layout: tests that render the list install `installFakeLayout()` in a
  `beforeEach` inside their `describe` and `restore()` it in the `afterEach`.
  No change to `vitest.setup.ts`. Every behaviour `LogcatView.test.tsx` checks
  today is kept; only selectors change, and a test removed rather than
  rewritten is listed in the PR with its reason.
- Git: stage explicit paths only (never `git add -A` / `.`, never
  `temp-appium/*`). Conventional messages (`feat(web): …`, `test(web): …`), no
  attribution lines. Never `eslint --fix` or `npm run lint` over the repo:
  ESLint and Prettier only on the files a task changes.

### Where each check runs

| Check | Here (cloud, no phones, no server) | Local machine |
|---|---|---|
| `cd web && npx vitest run` (whole web suite) | yes, every task | |
| `cd web && npx tsc --noEmit -p .` | yes, every task | |
| `npm run build:xenon` (repo root) | yes, Task 15 | |
| ESLint / Prettier on changed files | yes, Task 15 (with the main checkout's root `node_modules` linked) | |
| Playwright viewport spec (`npm run test:viewport`) | written in Task 14, not run | L1 |
| Control sweep (`npm run test:sweep`) | | L2 |
| Light-theme contrast probe | | L3 |
| Galaxy S9+ and iPhone checks | | L4, L5 |
| Performance before and after | | L6 |

## Review Focus

1. **A tag or app with spaces or a double quote** (`package:Food Truck`, a tag
   like `say "hi"`): "Show only this tag", "Hide this tag" and "Show only this
   app" must write a term that still matches the line. Task 3 pins it.
2. **Cmd/Ctrl+C while text is selected** (dragged inside a row, or in the
   details panel): the browser copies that text; the lines are copied only
   when nothing is text-selected and the list has focus. Task 9c pins it.
3. **A scroll nobody made** (the browser clamping after a filter shrinks the
   list, Xenon's own follow and anchor scrolls): it must neither pause nor
   resume following. Task 9a pins it.
4. **Clear lines or a reconnect with the details panel open:** the panel keeps
   the line and says "This line has left the buffer"; an empty buffer doesn't
   break the list, the level bar or the counts. Task 13 pins it.
5. **A level the platform has no button for** (iOS `level:W`, iOS `level:V`, a
   typo `level:X`): the bar presses the button whose lines are actually shown
   (Error, Debug), or All for a typo, never a level that disagrees with the
   list. Task 4 and Task 10 pin it.

---

### Task 1: The virtualizer dependency and a fake layout for jsdom

**Files:**
- Modify: `web/package.json`, `web/package-lock.json`
- Create: `web/src/components/device-control/logcat/testing/fakeLayout.ts`
- Test: `web/src/components/device-control/logcat/testing/fakeLayout.test.ts`

**Interfaces:**
- Produces:
  - `interface FakeLayoutOptions { viewportHeight?: number /* 400 */; viewportWidth?: number /* 800 */; rowHeight?: (row: HTMLElement) => number /* () => 20 */ }`
  - `interface FakeLayout { restore(): void }`
  - `installFakeLayout(options?: FakeLayoutOptions): FakeLayout`: removes
    `window.ResizeObserver` for its lifetime; for every `[role="listbox"]`
    element gives `offsetHeight`/`clientHeight` = viewport height,
    `offsetWidth`/`clientWidth` = viewport width, `scrollHeight` = the larger
    of the viewport and its tallest child's `style.height`, a `scrollTop`
    clamped to `[0, scrollHeight - clientHeight]` whose change dispatches
    `scroll` on a timer (as a browser does, after the change), and
    `scrollTo({ top })`; every `[data-index]` element (a row) gets
    `offsetHeight` = `rowHeight(row)`. Other elements keep jsdom's values.
  - `userScroll(list: HTMLElement, top: number): void`: a wheel on the list,
    then the list moves to `top` (clamped) and fires `scroll` at once.
  - `settle(): Promise<void>`: five rounds of
    `act(() => new Promise((r) => setTimeout(r, 20)))`, so queued scroll
    events and animation frames run.

- [ ] **Step 1: Install the dependency**

Run: `cd web && npm install @tanstack/react-virtual@^3.14 --no-audit --no-fund`
Expected: `web/package.json` gains `"@tanstack/react-virtual": "^3.14.x"`;
the lock file gains it and `@tanstack/virtual-core`.

- [ ] **Step 2: Write the failing test**

```ts
// web/src/components/device-control/logcat/testing/fakeLayout.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeLayout, settle, userScroll, type FakeLayout } from './fakeLayout';

const list = (contentHeight: number) => {
  const el = document.createElement('div');
  el.setAttribute('role', 'listbox');
  const sizer = document.createElement('div');
  sizer.style.height = `${contentHeight}px`;
  el.appendChild(sizer);
  document.body.appendChild(el);
  return el;
};

describe('installFakeLayout', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 400, rowHeight: () => 33 });
  });
  afterEach(() => {
    layout.restore();
    document.body.innerHTML = '';
  });

  it('gives a list its viewport and its content height', () => {
    const el = list(1000);
    expect(el.offsetHeight).toBe(400);
    expect(el.clientHeight).toBe(400);
    expect(el.offsetWidth).toBe(800);
    expect(el.scrollHeight).toBe(1000);
  });

  it('measures a row by its height function', () => {
    const row = document.createElement('div');
    row.setAttribute('data-index', '0');
    expect(row.offsetHeight).toBe(33);
  });

  it('clamps scrollTop, and says so after the change as a browser does', async () => {
    const el = list(1000);
    const onScroll = vi.fn();
    el.addEventListener('scroll', onScroll);
    el.scrollTop = 5000;
    expect(el.scrollTop).toBe(600);
    expect(onScroll).not.toHaveBeenCalled();
    await settle();
    expect(onScroll).toHaveBeenCalledTimes(1);
    el.scrollTo({ top: 100 });
    expect(el.scrollTop).toBe(100);
  });

  it('has the user scroll with a wheel first and a scroll event at once', () => {
    const el = list(1000);
    const seen: string[] = [];
    el.addEventListener('wheel', () => seen.push('wheel'));
    el.addEventListener('scroll', () => seen.push(`scroll ${el.scrollTop}`));
    userScroll(el, 250);
    expect(seen).toEqual(['wheel', 'scroll 250']);
  });

  it('has no ResizeObserver while installed', () => {
    expect('ResizeObserver' in window).toBe(false);
  });
});

describe('installFakeLayout: restore', () => {
  it('puts back everything it changed', () => {
    const had = 'ResizeObserver' in window;
    const layout = installFakeLayout();
    layout.restore();
    const el = list(1000);
    expect(el.offsetHeight).toBe(0);
    expect(el.scrollHeight).toBe(0);
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')).toBeUndefined();
    expect('ResizeObserver' in window).toBe(had);
    document.body.innerHTML = '';
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd web && npx vitest run src/components/device-control/logcat/testing/fakeLayout.test.ts`
Expected: FAIL, `Failed to resolve import "./fakeLayout"`.

- [ ] **Step 4: Write `fakeLayout.ts`**

Define the overrides on `HTMLElement.prototype` with `Object.defineProperty`
(configurable). Save each original own descriptor first (`offsetHeight` and
`offsetWidth` are own properties of `HTMLElement.prototype`; `clientHeight`,
`clientWidth`, `scrollHeight`, `scrollTop` and `scrollTo` are not, they live on
`Element.prototype`). `restore()` puts back a saved descriptor or deletes the
override. Keep `scrollTop` values in a `WeakMap<Element, number>`. Getters fall
through to the original getter (`saved.get.call(this)`) for elements that are
neither a list nor a row. `userScroll` uses `fireEvent.wheel` and
`fireEvent.scroll` from `@testing-library/react` (wrapped in `act`). A file
header says why it exists and that it is for tests only.

- [ ] **Step 5: Run it to make sure it passes, then the typecheck**

Run: `cd web && npx vitest run src/components/device-control/logcat/testing/ && npx tsc --noEmit -p .`
Expected: 6 passed; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/components/device-control/logcat/testing/fakeLayout.ts web/src/components/device-control/logcat/testing/fakeLayout.test.ts
git commit -m "build(web): add @tanstack/react-virtual and a jsdom layout for list tests"
```

---

### Task 2: `-tag:` and `-package:` hide lines

**Files:**
- Modify: `web/src/components/device-control/logcat/logcatFilter.ts` (`LogcatQuery`, `parseQuery`, `matches`, the grammar comment)
- Test: `web/src/components/device-control/logcat/logcatFilter.test.ts`, `web/src/components/device-control/logcat/iosSourceFilter.test.ts`

**Interfaces:**
- Produces: `LogcatQuery` gains `excludeTags?: string[]` and
  `excludePkgs?: string[]`, set only when at least one exclusion was given (so
  every existing `toEqual` on a parsed query still holds), values normalised
  as `tag`/`pkg` are.

- [ ] **Step 1: Write the failing tests**

Append to `logcatFilter.test.ts`:

```ts
describe('exclusions: -tag: and -package:', () => {
  it('parses each exclusion, lowercased unless Match case is on', () => {
    expect(parseQuery('-tag:Chatty -tag:Wifi -package:com.Foo')).toEqual({
      excludeTags: ['chatty', 'wifi'],
      excludePkgs: ['com.foo'],
    });
    expect(parseQuery('-tag:Chatty', { caseSensitive: true })).toEqual({
      caseSensitive: true,
      excludeTags: ['Chatty'],
    });
  });

  it('reads a quoted value as one exclusion', () => {
    expect(parseQuery('-package:"Food Truck" crash')).toEqual({
      excludePkgs: ['food truck'],
      text: 'crash',
    });
  });

  it('keeps a word starting with - and no colon, or an exclusion with no value, as text', () => {
    expect(parseQuery('-verbose')).toEqual({ text: '-verbose' });
    expect(parseQuery('-tag:')).toEqual({ text: '-tag:' });
  });

  it('hides lines whose tag or package contains an excluded value', () => {
    const q = parseQuery('-tag:chatty -package:com.noisy');
    expect(matches(rec({ tag: 'chatty' }), q)).toBe(false);
    expect(matches(rec({ tag: 'MyChattyTag' }), q)).toBe(false);
    expect(matches(rec({ pkg: 'com.noisy.app' }), q)).toBe(false);
    expect(matches(rec({ pkg: 'com.quiet' }), q)).toBe(true);
    // No package: nothing to exclude it by.
    expect(matches(rec({ pkg: undefined }), q)).toBe(true);
  });

  it('combines with the include terms', () => {
    const q = parseQuery('tag:wifi -tag:wifiscanner');
    expect(matches(rec({ tag: 'WifiService' }), q)).toBe(true);
    expect(matches(rec({ tag: 'WifiScanner' }), q)).toBe(false);
  });

  it('follows Match case', () => {
    const q = parseQuery('-tag:Wifi', { caseSensitive: true });
    expect(matches(rec({ tag: 'wifi' }), q)).toBe(true);
    expect(matches(rec({ tag: 'Wifi' }), q)).toBe(false);
  });

  it("never hides Xenon's own records", () => {
    const q = parseQuery('-tag:xenon');
    expect(matches(rec({ tag: 'xenon', level: 'W', synthetic: true }), q)).toBe(true);
  });
});
```

Append to `iosSourceFilter.test.ts` inside its `describe`:

```ts
  // Exclusions are applied in the browser only: the device is sent the
  // levels and an included package, nothing else.
  it('sends the device no exclusions', () => {
    expect(iosSourceFilter('-package:Noisy -tag:chatty')).toEqual({
      levels: ['Info', 'Default', 'Error', 'Fault'],
      process: undefined,
    });
    expect(iosSourceFilter('package:Maps -package:Noisy').process).toBe('Maps');
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd web && npx vitest run src/components/device-control/logcat/logcatFilter.test.ts src/components/device-control/logcat/iosSourceFilter.test.ts`
Expected: FAIL in the new `exclusions` tests (`-tag:Chatty` parses to
`{ text: '-tag:chatty …' }`). The iOS test passes already (it guards
`iosSourceFilter`, which this task must not change).

- [ ] **Step 3: Implement**

In `parseQuery`, a token whose key is `-tag` or `-package`
(case-insensitive) with a value pushes `norm(value)` onto the matching
array. In `matches`, after the synthetic check and the include terms: a
record is hidden when `excludeTags.some((t) => norm(r.tag).includes(t))` or
`excludePkgs.some((p) => norm(r.pkg ?? '').includes(p))`. Add the two terms
to the grammar comment.

- [ ] **Step 4: Run them to make sure they pass**

Run: the command from Step 2.
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/logcatFilter.ts web/src/components/device-control/logcat/logcatFilter.test.ts web/src/components/device-control/logcat/iosSourceFilter.test.ts
git commit -m "feat(web): -tag: and -package: hide lines in the log filter"
```

---

### Task 3: `withTerm` and `withExclusion`

**Files:**
- Modify: `web/src/components/device-control/logcat/logcatFilter.ts`
- Test: `web/src/components/device-control/logcat/logcatFilter.test.ts`

**Interfaces:**
- Produces:
  - `type TermKey = 'tag' | 'package'`
  - `withTerm(query: string, key: TermKey, value: string): string`: sets the
    one `key:` include term to `value`, in the place of the first one already
    there (later ones dropped), else at the end. Exclusions are left alone.
    An empty value returns `query` unchanged.
  - `withExclusion(query: string, key: TermKey, value: string): string`: adds
    `-key:value` at the end unless the same exclusion (same key, same value)
    is already there.
  - Both split the query into terms the way `tokenize` does but keep each
    term's quotes, and join with single spaces. A value is written through
    one rule: keep the longest run between double quotes (trimmed), so the
    term still matches its line; quote it when it contains whitespace.

- [ ] **Step 1: Write the failing tests**

Append to `logcatFilter.test.ts` (add `withTerm, withExclusion` to the import):

```ts
describe('withTerm', () => {
  it('adds a term at the end', () => {
    expect(withTerm('crash', 'tag', 'Wifi')).toBe('crash tag:Wifi');
    expect(withTerm('', 'package', 'com.example')).toBe('package:com.example');
  });

  it('replaces a term already there, in its place, and drops repeats', () => {
    expect(withTerm('tag:Old level:E tag:Older crash', 'tag', 'New')).toBe('tag:New level:E crash');
  });

  it('replaces a quoted term', () => {
    expect(withTerm('package:"Food Truck" x', 'package', 'Maps')).toBe('package:Maps x');
  });

  it('quotes a value with spaces, which reads back as one term', () => {
    const q = withTerm('', 'package', 'Food Truck');
    expect(q).toBe('package:"Food Truck"');
    expect(parseQuery(q).pkg).toBe('food truck');
  });

  it('leaves exclusions alone', () => {
    expect(withTerm('-tag:chatty', 'tag', 'Wifi')).toBe('-tag:chatty tag:Wifi');
  });

  it('writes a value with a double quote so that it still matches its line', () => {
    const tag = 'say "hi" there';
    expect(matches(rec({ tag }), parseQuery(withTerm('', 'tag', tag)))).toBe(true);
  });

  it('does nothing for an empty value', () => {
    expect(withTerm('x', 'tag', '')).toBe('x');
  });
});

describe('withExclusion', () => {
  it('adds an exclusion at the end, and several may be given', () => {
    expect(withExclusion('tag:Wifi', 'tag', 'chatty')).toBe('tag:Wifi -tag:chatty');
    expect(withExclusion('-tag:a', 'tag', 'b')).toBe('-tag:a -tag:b');
  });

  it('does not add the same exclusion twice', () => {
    expect(withExclusion('-tag:chatty x', 'tag', 'chatty')).toBe('-tag:chatty x');
    expect(withExclusion('-package:"Food Truck"', 'package', 'Food Truck')).toBe(
      '-package:"Food Truck"',
    );
  });

  it('quotes a value with spaces', () => {
    expect(withExclusion('', 'package', 'Food Truck')).toBe('-package:"Food Truck"');
  });

  it('hides the line it was made from', () => {
    const line = rec({ tag: 'My Tag' });
    expect(matches(line, parseQuery(withExclusion('', 'tag', 'My Tag')))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd web && npx vitest run src/components/device-control/logcat/logcatFilter.test.ts`
Expected: FAIL, `withTerm is not a function`.

- [ ] **Step 3: Implement `withTerm` and `withExclusion` in `logcatFilter.ts`**

- [ ] **Step 4: Run them to make sure they pass**

Run: the command from Step 2.
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/logcatFilter.ts web/src/components/device-control/logcat/logcatFilter.test.ts
git commit -m "feat(web): withTerm and withExclusion write filter terms for a line"
```

---

### Task 4: Lines per level

**Files:**
- Create: `web/src/components/device-control/logcat/levelCounts.ts`
- Test: `web/src/components/device-control/logcat/levelCounts.test.ts`

**Interfaces:**
- Consumes: `LEVEL_ORDER`, `matches`, `LogRecordLike`, `LogcatQuery` (logcatFilter).
- Produces:
  - `type Level = (typeof LEVEL_ORDER)[number]` and `type LevelCounts = Record<Level, number>`
  - `type LogPlatform = 'android' | 'ios'`
  - `countLevels(records: readonly LogRecordLike[], query: LogcatQuery): LevelCounts`:
    lines of each level that pass `query` with its `minLevel` removed; Xenon's
    own records and unknown letters are not counted.
  - `interface LevelChoice { level: Level; name: string }`
  - `levelChoices(platform: LogPlatform, counts: LevelCounts, minLevel: string | undefined): LevelChoice[]`:
    Android V, D, I, W, E, and F when `counts.F > 0` or `minLevel` is F; iOS
    D, I, E, F.
  - `chosenLevel(choices: readonly LevelChoice[], minLevel: string | undefined): Level | null`:
    the lowest offered level at or above `minLevel`; null for no level, an
    unknown one, or none offered at or above it.
  - `levelName(level: string, platform: LogPlatform): string`: Verbose, Debug,
    Info, Warning, Error, and F is Fatal on Android and Fault on iOS; an
    unknown letter is returned as it is.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/components/device-control/logcat/levelCounts.test.ts
import { describe, expect, it } from 'vitest';
import { parseQuery } from './logcatFilter';
import { chosenLevel, countLevels, levelChoices, levelName, type LevelCounts } from './levelCounts';

const line = (level: string, tag = 'Tag', synthetic = false) => ({ level, tag, message: 'm', synthetic });
const zero: LevelCounts = { V: 0, D: 0, I: 0, W: 0, E: 0, F: 0 };

describe('countLevels', () => {
  it('counts the lines of each level', () => {
    expect(countLevels([line('D'), line('D'), line('W'), line('E')], {})).toEqual({
      ...zero,
      D: 2,
      W: 1,
      E: 1,
    });
  });

  it('follows the filter, but not its level term', () => {
    const records = [line('D', 'Wifi'), line('E', 'Wifi'), line('E', 'Bluetooth')];
    expect(countLevels(records, parseQuery('level:E tag:wifi'))).toEqual({ ...zero, D: 1, E: 1 });
  });

  it("leaves Xenon's own records and unknown letters out", () => {
    expect(countLevels([line('W', 'xenon', true), line('X')], {})).toEqual(zero);
  });
});

describe('levelChoices', () => {
  it('offers the Android levels, and Fatal only when there is one', () => {
    expect(levelChoices('android', zero, undefined).map((c) => c.name)).toEqual([
      'Verbose', 'Debug', 'Info', 'Warning', 'Error',
    ]);
    expect(levelChoices('android', { ...zero, F: 1 }, undefined).map((c) => c.level)).toContain('F');
    expect(levelChoices('android', zero, 'F').map((c) => c.name)).toContain('Fatal');
  });

  it('offers the iOS levels', () => {
    expect(levelChoices('ios', zero, undefined).map((c) => c.name)).toEqual([
      'Debug', 'Info', 'Error', 'Fault',
    ]);
  });
});

describe('chosenLevel', () => {
  const android = levelChoices('android', zero, undefined);
  const ios = levelChoices('ios', zero, undefined);

  it('is the level asked for when it is offered', () => {
    expect(chosenLevel(android, 'W')).toBe('W');
    expect(chosenLevel(android, 'V')).toBe('V');
  });

  // iOS has no Warning or Verbose: the button pressed is the one whose
  // lines the list actually shows.
  it('is the lowest offered level above one the platform has no button for', () => {
    expect(chosenLevel(ios, 'W')).toBe('E');
    expect(chosenLevel(ios, 'V')).toBe('D');
  });

  it('is none for no level or a typo', () => {
    expect(chosenLevel(android, undefined)).toBeNull();
    expect(chosenLevel(android, 'X')).toBeNull();
  });
});

describe('levelName', () => {
  it('names each level, F by platform', () => {
    expect(levelName('W', 'android')).toBe('Warning');
    expect(levelName('F', 'android')).toBe('Fatal');
    expect(levelName('F', 'ios')).toBe('Fault');
    expect(levelName('Q', 'android')).toBe('Q');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd web && npx vitest run src/components/device-control/logcat/levelCounts.test.ts`
Expected: FAIL, `Failed to resolve import "./levelCounts"`.

- [ ] **Step 3: Write `levelCounts.ts`**

`countLevels` runs `matches` once per record against `{ ...query, minLevel: undefined }`.

- [ ] **Step 4: Run it to make sure it passes**

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/levelCounts.ts web/src/components/device-control/logcat/levelCounts.test.ts
git commit -m "feat(web): count log lines per level for the level bar"
```

---

### Task 5: Selection by `seq`

**Files:**
- Create: `web/src/components/device-control/logcat/logSelection.ts`
- Test: `web/src/components/device-control/logcat/logSelection.test.ts`

**Interfaces:**
- Consumes: `formatLine` (logcatRecording), `LogRecordLike`.
- Produces:
  - `interface LogSelection { selected: ReadonlySet<number>; anchor: number | null; active: number | null }` (all `seq`s)
  - `NO_SELECTION: LogSelection`
  - `interface ClickKeys { range: boolean; toggle: boolean }` (Shift; Cmd or Ctrl)
  - `clickSelection(sel: LogSelection, seq: number, order: readonly number[], keys: ClickKeys): LogSelection`
    (`order` = the shown lines' seqs in list order). Plain: just `seq`,
    anchor and active `seq`. Toggle: add or remove `seq`, anchor and active
    `seq`. Range: every seq between the anchor and `seq` in `order`, anchor
    kept, active `seq`; with no anchor in `order`, as plain.
  - `moveSelection(sel: LogSelection, order: readonly number[], step: 1 | -1, extend: boolean): LogSelection`:
    the next or previous line becomes active (clamped at the ends; with none
    active, ↓ takes the first and ↑ the last). Without `extend` only it is
    selected and it becomes the anchor; with `extend` the run from the anchor
    (the old active line when there was no anchor) to it is selected.
  - `selectedLines(shown: readonly (LogRecordLike & { seq: number; ts: number; pid: number })[], selected: ReadonlySet<number>): { text: string; count: number }`:
    the selected lines among `shown`, in list order, each as `formatLine`
    writes it, joined by `\n`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/components/device-control/logcat/logSelection.test.ts
import { describe, expect, it } from 'vitest';
import { formatLine } from './logcatRecording';
import { NO_SELECTION, clickSelection, moveSelection, selectedLines } from './logSelection';

const order = [10, 11, 12, 13, 14];
const plain = { range: false, toggle: false };
const seqs = (s: { selected: ReadonlySet<number> }) => Array.from(s.selected).sort((a, b) => a - b);
const rec = (seq: number) => ({ seq, ts: Date.UTC(2026, 9, 3, 10, 0, seq), pid: 7, level: 'I', tag: 'T', message: `m${seq}` });

describe('clickSelection', () => {
  it('a plain click selects one line and makes it the anchor and the active line', () => {
    const s = clickSelection(NO_SELECTION, 12, order, plain);
    expect(seqs(s)).toEqual([12]);
    expect(s.anchor).toBe(12);
    expect(s.active).toBe(12);
  });

  it('Cmd or Ctrl adds a line, and removes it the second time', () => {
    let s = clickSelection(NO_SELECTION, 11, order, plain);
    s = clickSelection(s, 13, order, { range: false, toggle: true });
    expect(seqs(s)).toEqual([11, 13]);
    s = clickSelection(s, 11, order, { range: false, toggle: true });
    expect(seqs(s)).toEqual([13]);
  });

  it('Shift selects the run between the anchor and the line, in list order', () => {
    let s = clickSelection(NO_SELECTION, 11, order, plain);
    s = clickSelection(s, 13, order, { range: true, toggle: false });
    expect(seqs(s)).toEqual([11, 12, 13]);
    s = clickSelection(s, 10, order, { range: true, toggle: false });
    expect(seqs(s)).toEqual([10, 11]);
    expect(s.anchor).toBe(11);
  });

  it('Shift with no anchor on screen selects just that line', () => {
    const s = clickSelection({ selected: new Set([99]), anchor: 99, active: 99 }, 12, order, {
      range: true,
      toggle: false,
    });
    expect(seqs(s)).toEqual([12]);
  });

  // The buffer drops its oldest lines; seqs don't move, so a range still works.
  it('still selects a range after the oldest lines were dropped', () => {
    const s = clickSelection(NO_SELECTION, 12, order, plain);
    expect(seqs(clickSelection(s, 14, [12, 13, 14, 15], { range: true, toggle: false }))).toEqual([12, 13, 14]);
  });
});

describe('moveSelection', () => {
  it('starts at the first line going down and the last going up', () => {
    expect(moveSelection(NO_SELECTION, order, 1, false).active).toBe(10);
    expect(moveSelection(NO_SELECTION, order, -1, false).active).toBe(14);
  });

  it('steps the active line and selects only it, clamped at the ends', () => {
    let s = clickSelection(NO_SELECTION, 13, order, plain);
    s = moveSelection(s, order, 1, false);
    expect(seqs(s)).toEqual([14]);
    expect(moveSelection(s, order, 1, false).active).toBe(14);
  });

  it('with Shift, grows the run from the anchor', () => {
    let s = clickSelection(NO_SELECTION, 11, order, plain);
    s = moveSelection(s, order, 1, true);
    s = moveSelection(s, order, 1, true);
    expect(seqs(s)).toEqual([11, 12, 13]);
    expect(s.active).toBe(13);
    expect(s.anchor).toBe(11);
  });
});

describe('selectedLines', () => {
  it('copies the selected lines in list order, as Export writes them', () => {
    const shown = [rec(1), rec(2), rec(3)];
    expect(selectedLines(shown, new Set([3, 1]))).toEqual({
      text: `${formatLine(shown[0])}\n${formatLine(shown[2])}`,
      count: 2,
    });
  });

  it('leaves out selected lines the filter hides', () => {
    expect(selectedLines([rec(1)], new Set([1, 2])).count).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd web && npx vitest run src/components/device-control/logcat/logSelection.test.ts`
Expected: FAIL, `Failed to resolve import "./logSelection"`.

- [ ] **Step 3: Write `logSelection.ts`** (ES5 target: build sets with `new Set(array)`, read them with `forEach`/`Array.from`).

- [ ] **Step 4: Run it to make sure it passes**

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/logSelection.ts web/src/components/device-control/logcat/logSelection.test.ts
git commit -m "feat(web): select log lines by seq, with ranges and toggles"
```

---

### Task 6: Find highlighting

**Files:**
- Create: `web/src/components/device-control/logcat/findHighlight.ts`
- Test: `web/src/components/device-control/logcat/findHighlight.test.ts`

**Interfaces:**
- Produces: `interface TextPart { text: string; hit: boolean }` and
  `splitMatches(text: string, needle: string, caseSensitive: boolean): TextPart[]`:
  the text split around each non-overlapping match, left to right, with the
  text's own case kept; an empty needle or no match gives one part.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/components/device-control/logcat/findHighlight.test.ts
import { describe, expect, it } from 'vitest';
import { splitMatches } from './findHighlight';

describe('splitMatches', () => {
  it('gives the whole text when there is nothing to find', () => {
    expect(splitMatches('Wifi on', '', false)).toEqual([{ text: 'Wifi on', hit: false }]);
    expect(splitMatches('Wifi on', 'zzz', false)).toEqual([{ text: 'Wifi on', hit: false }]);
  });

  it('finds every match, ignoring case by default, and keeps the text as written', () => {
    expect(splitMatches('Wifi on, wifi off', 'WIFI', false)).toEqual([
      { text: 'Wifi', hit: true },
      { text: ' on, ', hit: false },
      { text: 'wifi', hit: true },
      { text: ' off', hit: false },
    ]);
  });

  it('finds only the exact case with Match case on', () => {
    expect(splitMatches('Wifi on, wifi off', 'wifi', true)).toEqual([
      { text: 'Wifi on, ', hit: false },
      { text: 'wifi', hit: true },
      { text: ' off', hit: false },
    ]);
  });

  it('handles matches at both ends and side by side', () => {
    expect(splitMatches('aaaa', 'aa', false)).toEqual([
      { text: 'aa', hit: true },
      { text: 'aa', hit: true },
    ]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** — `npx vitest run src/components/device-control/logcat/findHighlight.test.ts`, FAIL on the import.
- [ ] **Step 3: Write `findHighlight.ts`.**
- [ ] **Step 4: Run it to make sure it passes** — 4 passed.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/findHighlight.ts web/src/components/device-control/logcat/findHighlight.test.ts
git commit -m "feat(web): split a log message around its Find matches"
```

---

### Task 7: On/off menu items

**Files:**
- Modify: `web/src/components/ui/Menu.tsx` (`MenuItemProps`, `MenuItem`)
- Test: `web/src/components/ui/menu.test.tsx`

**Interfaces:**
- Produces: `MenuItemProps.checkbox?: boolean`: with it, the item is a
  `menuitemcheckbox` (an independent on/off choice) and `checked` says
  whether it is on; without it `checked` keeps meaning `menuitemradio`.

- [ ] **Step 1: Write the failing test** (append inside `describe('Menu')`)

```tsx
  it('a checkbox item is an on/off choice of its own', () => {
    render(
      <Menu>
        <MenuItem checkbox checked onClick={() => {}}>
          Wrap long lines
        </MenuItem>
        <MenuItem checkbox checked={false} onClick={() => {}}>
          Match case
        </MenuItem>
        <MenuItem checked onClick={() => {}}>
          Newest first
        </MenuItem>
      </Menu>,
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Match case' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemradio', { name: 'Newest first' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to make sure it fails** — `cd web && npx vitest run src/components/ui/menu.test.tsx`, FAIL: no `menuitemcheckbox`.
- [ ] **Step 3: Add the prop** (role `menuitemcheckbox` when `checkbox`, check mark shown when `checked`).
- [ ] **Step 4: Run it to make sure it passes**, with the rest of `menu.test.tsx`.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/Menu.tsx web/src/components/ui/menu.test.tsx
git commit -m "feat(web): menu items can be independent checkboxes"
```

---

### Task 8: One row, and the shared formats

**Files:**
- Create: `web/src/components/device-control/logcat/logFormat.ts`
- Create: `web/src/components/device-control/logcat/LogRow.tsx`
- Test: `web/src/components/device-control/logcat/logFormat.test.ts`, `web/src/components/device-control/logcat/LogRow.test.tsx`

**Interfaces:**
- Consumes: `BufferedLogcatRecord`, `tagColor`, `splitMatches`.
- Produces:
  - `formatCount(n: number): string` (`n.toLocaleString('en-US')`),
    `formatTime(ts: number): string` (`HH:MM:SS`, 24 h, local time, one shared
    `Intl.DateTimeFormat`), `formatTimeMs(ts: number): string` (`HH:MM:SS.mmm`).
  - `interface LogRowProps { record: BufferedLogcatRecord; index: number; setSize: number; start: number; id: string; selected: boolean; active: boolean; hit: boolean; activeHit: boolean; find: string; caseSensitive: boolean; measureRef: (el: Element | null) => void }`
  - `LogRow` (memoized): a `div` `role="option"` with `id`,
    `aria-selected`, `aria-setsize`, `aria-posinset` (`index + 1`),
    `data-index` (`index`, for the virtualizer's measuring), `data-seq`, class
    `log-row lvl-<level>` plus `is-synthetic`, `is-hit`, `is-active-hit`,
    `is-active`, and `transform: translateY(<start>px)`. Children in order:
    `.log-time`, `.log-badge` (the level letter), `.log-tag` (tag colour,
    full tag in `title`), `.log-pkg` (full package in `title`), `.log-msg`.
    Find matches inside the tag and the message are `<mark class="log-mark">`.
    Xenon's own records render time, badge and message only. PID and TID are
    not in the row.

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/components/device-control/logcat/logFormat.test.ts
import { describe, expect, it } from 'vitest';
import { formatCount, formatTime, formatTimeMs } from './logFormat';

describe('logFormat', () => {
  it('writes counts with thousands separators', () => {
    expect(formatCount(2629)).toBe('2,629');
    expect(formatCount(7)).toBe('7');
  });

  it('writes the time to the second, and to the millisecond for details', () => {
    const ts = Date.UTC(2026, 7, 9, 16, 11, 5) + 42;
    expect(formatTime(ts)).toMatch(/^\d\d:\d\d:05$/);
    expect(formatTimeMs(ts)).toMatch(/^\d\d:\d\d:05\.042$/);
  });
});
```

```tsx
// web/src/components/device-control/logcat/LogRow.test.tsx
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LogRow, type LogRowProps } from './LogRow';
import { tagColor } from './tagColor';

const toRgb = (hex: string) => {
  const m = /^#(..)(..)(..)$/.exec(hex);
  return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex;
};

const record = {
  seq: 5,
  ts: Date.UTC(2026, 7, 9, 16, 11, 0),
  pid: 1408,
  tid: 1409,
  level: 'E',
  tag: 'ActivityManager',
  pkg: 'com.android.systemui',
  message: 'ANR in com.android.systemui',
};

const row = (over: Partial<LogRowProps> = {}) => {
  const props: LogRowProps = {
    record,
    index: 4,
    setSize: 10,
    start: 80,
    id: 'log-opt-5',
    selected: false,
    active: false,
    hit: false,
    activeHit: false,
    find: '',
    caseSensitive: false,
    measureRef: () => {},
    ...over,
  };
  const { container } = render(<LogRow {...props} />);
  return container.querySelector('[role="option"]') as HTMLElement;
};

describe('LogRow', () => {
  it('shows the time, the level, the tag, the package and the message, not the PID and TID', () => {
    const el = row();
    expect(el.querySelector('.log-time')?.textContent).toMatch(/^\d\d:\d\d:00$/);
    expect(el.querySelector('.log-badge')?.textContent).toBe('E');
    expect(el.querySelector('.log-tag')?.textContent).toBe('ActivityManager');
    expect(el.querySelector('.log-pkg')?.textContent).toBe('com.android.systemui');
    expect(el.querySelector('.log-msg')?.textContent).toBe('ANR in com.android.systemui');
    expect(el.textContent).not.toContain('1408');
  });

  it('puts the full tag and package in their titles, and colours the tag from the tag', () => {
    const el = row();
    const tag = el.querySelector('.log-tag') as HTMLElement;
    expect(tag.title).toBe('ActivityManager');
    expect(el.querySelector('.log-pkg')?.getAttribute('title')).toBe('com.android.systemui');
    expect(tag.style.color).toBe(toRgb(tagColor('ActivityManager')));
  });

  it('marks its level, and says where it is among the shown lines', () => {
    const el = row();
    expect(el).toHaveClass('log-row', 'lvl-E');
    expect(el).toHaveAttribute('aria-posinset', '5');
    expect(el).toHaveAttribute('aria-setsize', '10');
    expect(el).toHaveAttribute('data-index', '4');
    expect(el).toHaveAttribute('aria-selected', 'false');
    expect(el.style.transform).toBe('translateY(80px)');
  });

  it('highlights each Find match in the tag and the message, and marks the hit', () => {
    const el = row({ find: 'activity', hit: true, activeHit: true });
    expect(Array.from(el.querySelectorAll('mark.log-mark')).map((m) => m.textContent)).toEqual(['Activity']);
    expect(el).toHaveClass('is-hit', 'is-active-hit');
  });

  it("shows Xenon's own record without tag and package", () => {
    const el = row({ record: { ...record, synthetic: true, level: 'W', tag: 'xenon', message: '3 lines dropped (slow client)' } });
    expect(el).toHaveClass('is-synthetic');
    expect(el.querySelector('.log-tag')).toBeNull();
    expect(el.querySelector('.log-msg')?.textContent).toBe('3 lines dropped (slow client)');
  });

  it('is selected through aria-selected, and active through a class', () => {
    expect(row({ selected: true, active: true })).toHaveAttribute('aria-selected', 'true');
    expect(row({ active: true })).toHaveClass('is-active');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail** — `cd web && npx vitest run src/components/device-control/logcat/logFormat.test.ts src/components/device-control/logcat/LogRow.test.tsx`, FAIL on the imports.
- [ ] **Step 3: Write `logFormat.ts` and `LogRow.tsx`.**
- [ ] **Step 4: Run them to make sure they pass** — 8 passed; then `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/logFormat.ts web/src/components/device-control/logcat/logFormat.test.ts web/src/components/device-control/logcat/LogRow.tsx web/src/components/device-control/logcat/LogRow.test.tsx
git commit -m "feat(web): one log row with a level badge and Find highlighting"
```

---

### Task 9: The list (`LogList.tsx`)

Four steps of one component, each its own commit. Decided here, as the spec
asks: the behaviour tests run in jsdom under `installFakeLayout` (a spike of
this exact setup passed: 13 of 5,000 rows rendered and followed, and the
reading place held across a front trim with rows of mixed heights). If that
proves brittle later, those tests move to Playwright against a mocked stream.

**Files:**
- Create: `web/src/components/device-control/logcat/LogList.tsx`
- Test: `web/src/components/device-control/logcat/LogList.test.tsx`

**Interfaces:**
- Consumes: `LogRow`, `formatCount`, `LogSelection` / `clickSelection` /
  `moveSelection`, `installFakeLayout` / `userScroll` / `settle` (tests).
- Produces:
  - `FOLLOW_SLACK_PX = 24`, `USER_INTENT_MS = 1000`
  - `interface LogListHandle { reveal(index: number): void; focus(): void }`
  - `interface LogListProps { records: readonly BufferedLogcatRecord[] /* shown lines */; oldestSeq: number | null /* the buffer's oldest line */; wrap: boolean; find: string; caseSensitive: boolean; hits: ReadonlySet<number> /* indexes */; activeHit: number | null; following: boolean; newLines: number; onPause(): void; onFollow(): void; selection: LogSelection; onSelect(next: LogSelection, active: BufferedLogcatRecord | null, via: 'click' | 'key'): void; onOpenDetails(record: BufferedLogcatRecord): void; onCopy(): void }`
  - `LogList`: `forwardRef<LogListHandle, LogListProps>`. Renders a
    `.log-list-wrap` holding, in order: the dropped note (when shown), the
    `role="listbox"` scroller (`aria-label="Log lines"`,
    `aria-multiselectable="true"`, `tabIndex={0}`, `aria-activedescendant` =
    the active row's id when it is shown, class `log-list` plus `is-nowrap`
    when `wrap` is off) with one `.log-list-sizer` child of the total height,
    and the new-lines pill while paused.
  - `useVirtualizer` options: `count`, `getScrollElement`, `getItemKey: (i) => records[i].seq`,
    `estimateSize` 20 or 38 by whether the list is at least 720 px wide
    (read with a `ResizeObserver` when there is one, else `offsetWidth` once),
    `overscan: 10`, `anchorTo: following ? 'start' : 'end'` (the virtualizer
    keeps the first line on screen at its offset when the list's ends
    change), `rangeExtractor` that adds the active line's index, and a
    `scrollToFn` that records its target before calling `elementScroll`.
    `virtualizer.measure()` runs when `wrap` or the width mode changes.

Who scrolled, the rule both directions use:

```ts
// A scroll is the user's only if it isn't where Xenon last scrolled to, and
// the user has just wheeled, touched, pressed a scroll key or the scrollbar.
// Anything else (Xenon's own follow and anchor scrolls, the browser clamping
// after the list shrank) neither pauses nor resumes.
const onScroll = () => {
  const top = el.scrollTop;
  if (ownTarget.current !== null && Math.abs(top - ownTarget.current) < 2) return;
  ownTarget.current = null;
  if (!pointerDown.current && Date.now() - intentAt.current > USER_INTENT_MS) return;
  const fromBottom = el.scrollHeight - el.clientHeight - top;
  if (following.current && fromBottom > FOLLOW_SLACK_PX) onPause.current();
  else if (!following.current && fromBottom <= FOLLOW_SLACK_PX) onFollow.current();
};
```

Intent comes from `wheel`, `touchstart`, `touchmove`, a `pointerdown` whose
target is the scroller itself (its scrollbar), and `keydown` of `PageUp`,
`PageDown`, `Home` or Space. The callbacks are read through refs so the
listener is added once.

Test fixtures shared by the four steps (top of `LogList.test.tsx`):

```tsx
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LogList, type LogListHandle, type LogListProps } from './LogList';
import { NO_SELECTION, type LogSelection } from './logSelection';
import { installFakeLayout, settle, userScroll, type FakeLayout } from './testing/fakeLayout';
import type { BufferedLogcatRecord } from './useLogcatStream';

const lines = (n: number, from = 0): BufferedLogcatRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    seq: from + i,
    ts: Date.UTC(2026, 9, 3, 10, 0, 0) + (from + i) * 10,
    pid: 1,
    tid: 1,
    level: 'I',
    tag: 'Tag',
    pkg: 'com.example',
    message: `line ${from + i}`,
  }));

function Harness(props: Partial<LogListProps> & { listRef?: React.Ref<LogListHandle> }) {
  const [selection, setSelection] = React.useState<LogSelection>(NO_SELECTION);
  const { listRef, ...rest } = props;
  const records = rest.records ?? lines(50);
  return (
    <LogList
      ref={listRef}
      records={records}
      oldestSeq={records.length ? records[0].seq : null}
      wrap
      find=""
      caseSensitive={false}
      hits={new Set()}
      activeHit={null}
      following
      newLines={0}
      onPause={() => {}}
      onFollow={() => {}}
      selection={selection}
      onSelect={(next) => setSelection(next)}
      onOpenDetails={() => {}}
      onCopy={() => {}}
      {...rest}
    />
  );
}

const list = () => screen.getByRole('listbox', { name: 'Log lines' });
const posinsets = () => screen.getAllByRole('option').map((o) => Number(o.getAttribute('aria-posinset')));
const top = (el: HTMLElement) => Number(/translateY\(([-\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0);
/** The first row on screen: its seq and how far its top sits from the list's top. */
const firstOnScreen = () => {
  const scrollTop = list().scrollTop;
  const rows = screen.getAllByRole('option').sort((a, b) => top(a) - top(b));
  const first = rows.find((r) => top(r) + r.offsetHeight > scrollTop)!;
  return { seq: first.getAttribute('data-seq'), offset: top(first) - scrollTop };
};
const bottom = () => list().scrollHeight - list().clientHeight;
```

#### Task 9a: Rendering, following and pausing

- [ ] **Step 1: Write the failing tests**

```tsx
describe('LogList: rows, following and pausing', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 400 });
  });
  afterEach(() => layout.restore());

  it('renders only the rows on screen out of 5,000, each saying where it is', async () => {
    render(<Harness records={lines(5000)} />);
    await settle();
    const rows = screen.getAllByRole('option');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    rows.forEach((r) => expect(r).toHaveAttribute('aria-setsize', '5000'));
    // Following: the newest line is on screen.
    expect(posinsets()).toContain(5000);
  });

  it('is a named list of lines, several of which may be selected', () => {
    render(<Harness />);
    expect(list()).toHaveAttribute('aria-multiselectable', 'true');
    expect(list()).toHaveAttribute('tabindex', '0');
  });

  it('follows new lines, and its own scrolls never pause it', async () => {
    const onPause = vi.fn();
    const { rerender } = render(<Harness records={lines(500)} onPause={onPause} />);
    await settle();
    for (const n of [520, 540, 560]) {
      rerender(<Harness records={lines(n)} onPause={onPause} />);
      await settle();
    }
    expect(posinsets()).toContain(560);
    expect(list().scrollTop).toBe(bottom());
    expect(onPause).not.toHaveBeenCalled();
  });

  it('pauses when the user scrolls up more than 24 px from the bottom', async () => {
    const onPause = vi.fn();
    render(<Harness records={lines(500)} onPause={onPause} />);
    await settle();
    userScroll(list(), bottom() - 24);
    expect(onPause).not.toHaveBeenCalled();
    userScroll(list(), bottom() - 25);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  // The browser clamping after a filter shrank the list, say: nobody scrolled.
  it('takes no scroll for the user without a wheel, touch, key or scrollbar', async () => {
    const onPause = vi.fn();
    const onFollow = vi.fn();
    const { rerender } = render(<Harness records={lines(500)} onPause={onPause} onFollow={onFollow} />);
    await settle();
    list().scrollTop = 0;
    await settle();
    expect(onPause).not.toHaveBeenCalled();
    rerender(<Harness records={lines(500)} following={false} onPause={onPause} onFollow={onFollow} />);
    list().scrollTop = bottom();
    await settle();
    expect(onFollow).not.toHaveBeenCalled();
  });

  it('follows again when the user scrolls back to the bottom', async () => {
    const onFollow = vi.fn();
    render(<Harness records={lines(500)} following={false} onFollow={onFollow} />);
    await settle();
    userScroll(list(), 0);
    expect(onFollow).not.toHaveBeenCalled();
    userScroll(list(), bottom() - 10);
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it('counts the new lines while paused, and Jump to latest follows', () => {
    const onFollow = vi.fn();
    const { rerender } = render(<Harness following={false} newLines={1342} onFollow={onFollow} />);
    fireEvent.click(screen.getByRole('button', { name: '1,342 new lines · Jump to latest' }));
    expect(onFollow).toHaveBeenCalledTimes(1);
    rerender(<Harness following={false} newLines={1} onFollow={onFollow} />);
    expect(screen.getByRole('button', { name: '1 new line · Jump to latest' })).toBeInTheDocument();
    rerender(<Harness following={false} newLines={0} onFollow={onFollow} />);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeInTheDocument();
    rerender(<Harness following newLines={0} onFollow={onFollow} />);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail** — `cd web && npx vitest run src/components/device-control/logcat/LogList.test.tsx`, FAIL on the import.
- [ ] **Step 3: Write `LogList.tsx`:** the virtualizer, the rows, the follow
  effect (`useLayoutEffect` on `following`, the last seq, the count and
  `getTotalSize()`: when following, `virtualizer.scrollToOffset(totalSize)`),
  the scroll rule above, and the pill (`${formatCount(n)} new line(s) · Jump
  to latest`, or `Jump to latest` with none).
- [ ] **Step 4: Run them to make sure they pass**; then `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/LogList.tsx web/src/components/device-control/logcat/LogList.test.tsx
git commit -m "feat(web): a virtual log list that follows, and pauses when you scroll up"
```

#### Task 9b: The place you are reading stays put

- [ ] **Step 1: Write the failing tests**

```tsx
describe('LogList: keeping the reading place', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    // Wrapped rows of mixed heights: every third line takes two lines.
    layout = installFakeLayout({
      viewportHeight: 400,
      rowHeight: (row) => (Number(row.getAttribute('data-seq')) % 3 === 0 ? 40 : 20),
    });
  });
  afterEach(() => layout.restore());

  it('keeps the first line on screen where it was when the oldest lines are dropped', async () => {
    const { rerender } = render(<Harness records={lines(1000)} following={false} />);
    await settle();
    userScroll(list(), 5000);
    await settle();
    const before = firstOnScreen();
    rerender(<Harness records={lines(1000, 100)} following={false} />);
    await settle();
    expect(firstOnScreen()).toEqual(before);
    expect(screen.queryByText('Older lines were dropped while paused')).toBeNull();
  });

  it('says so when the line being read has itself been dropped, and shows the oldest left', async () => {
    const { rerender } = render(<Harness records={lines(1000)} following={false} />);
    await settle();
    userScroll(list(), 200);
    await settle();
    rerender(<Harness records={lines(1000, 500)} following={false} />);
    await settle();
    expect(screen.getByText('Older lines were dropped while paused')).toBeInTheDocument();
    expect(firstOnScreen().seq).toBe('500');
    rerender(<Harness records={lines(1000, 500)} following />);
    await settle();
    expect(screen.queryByText('Older lines were dropped while paused')).toBeNull();
  });

  // A filter hiding the line is not the buffer dropping it.
  it('says nothing about dropped lines when the line is only filtered out', async () => {
    const all = lines(1000);
    const { rerender } = render(<Harness records={all} following={false} />);
    await settle();
    userScroll(list(), 200);
    await settle();
    rerender(<Harness records={all.filter((r) => r.seq >= 50)} oldestSeq={0} following={false} />);
    await settle();
    expect(screen.queryByText('Older lines were dropped while paused')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail** — the dropped note does not exist yet.
- [ ] **Step 3: Implement:** remember the first line on screen
  (`virtualizer.getVirtualItemForOffset(scrollTop)`) after every render and
  scroll; in a layout effect on `records`, while paused, if that seq is older
  than `oldestSeq`, show the note and `scrollToOffset(0)`. Hide the note when
  following starts. Copy: "Older lines were dropped while paused".
- [ ] **Step 4: Run them to make sure they pass**, with 9a's.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/LogList.tsx web/src/components/device-control/logcat/LogList.test.tsx
git commit -m "feat(web): the log list keeps your reading place while paused"
```

#### Task 9c: Selecting, copying and the list keys

- [ ] **Step 1: Write the failing tests**

```tsx
describe('LogList: selecting and keys', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 400 });
  });
  afterEach(() => layout.restore());

  const option = (seq: number) => document.querySelector(`[role="option"][data-seq="${seq}"]`) as HTMLElement;
  const selectedSeqs = () =>
    screen
      .getAllByRole('option')
      .filter((o) => o.getAttribute('aria-selected') === 'true')
      .map((o) => Number(o.getAttribute('data-seq')));

  it('selects on click, a range with Shift, and adds or removes one with Cmd or Ctrl', async () => {
    render(<Harness records={lines(10)} following={false} />);
    await settle();
    fireEvent.click(option(3));
    fireEvent.click(option(5), { shiftKey: true });
    expect(selectedSeqs()).toEqual([3, 4, 5]);
    fireEvent.click(option(4), { ctrlKey: true });
    fireEvent.click(option(7), { metaKey: true });
    expect(selectedSeqs()).toEqual([3, 5, 7]);
  });

  it('tells the parent which line was clicked', async () => {
    const onSelect = vi.fn();
    render(<Harness records={lines(10)} following={false} onSelect={onSelect} />);
    await settle();
    fireEvent.click(option(2));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ active: 2 }),
      expect.objectContaining({ seq: 2 }),
      'click',
    );
  });

  it('copies with Cmd or Ctrl+C when lines are selected', async () => {
    const onCopy = vi.fn();
    render(<Harness records={lines(10)} following={false} onCopy={onCopy} />);
    await settle();
    fireEvent.keyDown(list(), { key: 'c', metaKey: true });
    expect(onCopy).not.toHaveBeenCalled();
    fireEvent.click(option(1));
    fireEvent.keyDown(list(), { key: 'c', metaKey: true });
    fireEvent.keyDown(list(), { key: 'c', ctrlKey: true });
    expect(onCopy).toHaveBeenCalledTimes(2);
  });

  it('leaves Cmd or Ctrl+C to the browser while text is selected', async () => {
    const onCopy = vi.fn();
    render(<Harness records={lines(10)} following={false} onCopy={onCopy} />);
    await settle();
    fireEvent.click(option(1));
    const spy = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'line 1' } as Selection);
    try {
      fireEvent.keyDown(list(), { key: 'c', metaKey: true });
      expect(onCopy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('moves the active line with the arrows, extends with Shift, and opens details with Enter', async () => {
    const onOpenDetails = vi.fn();
    render(<Harness records={lines(10)} following={false} onOpenDetails={onOpenDetails} />);
    await settle();
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(list()).toHaveAttribute('aria-activedescendant', option(1).id);
    fireEvent.keyDown(list(), { key: 'ArrowDown', shiftKey: true });
    expect(selectedSeqs()).toEqual([1, 2]);
    fireEvent.keyDown(list(), { key: 'Enter' });
    expect(onOpenDetails).toHaveBeenCalledWith(expect.objectContaining({ seq: 2 }));
  });

  it('pauses when the arrows leave the newest line, and End follows again', async () => {
    const onPause = vi.fn();
    const onFollow = vi.fn();
    render(<Harness records={lines(10)} onPause={onPause} onFollow={onFollow} />);
    await settle();
    fireEvent.keyDown(list(), { key: 'ArrowUp' }); // the newest line: still following
    expect(onPause).not.toHaveBeenCalled();
    fireEvent.keyDown(list(), { key: 'ArrowUp' });
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(list(), { key: 'End' });
    expect(onFollow).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail.**
- [ ] **Step 3: Implement:** one `onClick` on the scroller finds the row with
  `closest('[data-seq]')` and calls `clickSelection` (Shift = range, Cmd or
  Ctrl = toggle), ignoring a click that ended a text selection; `onMouseDown`
  with Shift prevents the browser's text selection and focuses the list.
  `onKeyDown`: ↑/↓ (`moveSelection`, then `reveal` the new active line, and
  `onPause()` when it isn't the newest line), Enter (`onOpenDetails`), End
  (`onFollow`), Cmd/Ctrl+C (`onCopy` when the selection isn't empty and
  `window.getSelection()?.toString()` is empty), each with `preventDefault`.
  Esc is not handled here: it bubbles to the view.
- [ ] **Step 4: Run them to make sure they pass**, with 9a and 9b.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/LogList.tsx web/src/components/device-control/logcat/LogList.test.tsx
git commit -m "feat(web): select, copy and move through log lines from the keyboard"
```

#### Task 9d: Reaching a line that isn't rendered

- [ ] **Step 1: Write the failing test**

```tsx
describe('LogList: reveal', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({ viewportHeight: 400 });
  });
  afterEach(() => layout.restore());

  it('scrolls a line that is not rendered into view, for Find', async () => {
    const ref = React.createRef<LogListHandle>();
    render(<Harness listRef={ref} records={lines(5000)} following={false} />);
    await settle();
    expect(screen.queryByText('line 4000')).toBeNull();
    act(() => ref.current!.reveal(4000));
    await settle();
    expect(screen.getByText('line 4000')).toBeInTheDocument();
  });

  it('can be focused by the parent', () => {
    const ref = React.createRef<LogListHandle>();
    render(<Harness listRef={ref} />);
    act(() => ref.current!.focus());
    expect(document.activeElement).toBe(list());
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** (no `reveal` on the handle yet).
- [ ] **Step 3: Implement** the handle with `useImperativeHandle`: `reveal`
  = `virtualizer.scrollToIndex(index, { align: 'center' })`, `focus` =
  `scroller.focus({ preventScroll: true })`.
- [ ] **Step 4: Run the whole file to make sure it passes**; then `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/LogList.tsx web/src/components/device-control/logcat/LogList.test.tsx
git commit -m "feat(web): the log list can bring any line into view"
```

---

### Task 10: The level bar

**Files:**
- Create: `web/src/components/device-control/logcat/LevelBar.tsx`
- Test: `web/src/components/device-control/logcat/LevelBar.test.tsx`

**Interfaces:**
- Consumes: `levelChoices`, `chosenLevel`, `LevelCounts`, `LogPlatform`,
  `formatCount`, `ui/button`.
- Produces: `interface LevelBarProps { platform: LogPlatform; counts: LevelCounts; minLevel: string | undefined; shown: number; total: number; onChoose(level: string): void /* '' = All */ }`
  and `LevelBar`: a `role="group"` named "Log levels" with an "All" button
  (`aria-label="All levels"`) and one button per choice. Each shows its name
  and count and is named for what it does: `"<Name> and above, <n> <name> line(s)"`,
  or `"<Name> only, …"` for F, the highest level. `aria-pressed` on the chosen
  one (All when none); the levels it includes get `is-included`. Clicking the
  chosen level calls `onChoose('')`. At the right, `"<shown> of <total> shown"`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/device-control/logcat/LevelBar.test.tsx
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LevelBar, type LevelBarProps } from './LevelBar';

const counts = { V: 300, D: 1200, I: 900, W: 117, E: 51, F: 0 };
const bar = (over: Partial<LevelBarProps> = {}) =>
  render(
    <LevelBar platform="android" counts={counts} minLevel={undefined} shown={168} total={2629} onChoose={vi.fn()} {...over} />,
  );
const names = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));

describe('LevelBar', () => {
  it('names each Android level for what it does, with its count', () => {
    bar();
    expect(names()).toEqual([
      'All levels',
      'Verbose and above, 300 verbose lines',
      'Debug and above, 1,200 debug lines',
      'Info and above, 900 info lines',
      'Warning and above, 117 warning lines',
      'Error and above, 51 error lines',
    ]);
  });

  it('adds Fatal only when there is one, named for what it selects', () => {
    bar({ counts: { ...counts, F: 1 } });
    expect(names()).toContain('Fatal only, 1 fatal line');
  });

  it('offers the iOS levels', () => {
    bar({ platform: 'ios', counts: { ...counts, F: 2 } });
    expect(names()).toEqual([
      'All levels',
      'Debug and above, 1,200 debug lines',
      'Info and above, 900 info lines',
      'Error and above, 51 error lines',
      'Fault only, 2 fault lines',
    ]);
  });

  it('presses the chosen level and tints the levels it includes', () => {
    bar({ minLevel: 'W' });
    expect(screen.getByRole('button', { name: /^Warning/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All levels' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Error/ })).toHaveClass('is-included');
    expect(screen.getByRole('button', { name: /^Info/ })).not.toHaveClass('is-included');
  });

  it('presses All for a typo, and the shown level for one iOS has no button for', () => {
    const { unmount } = bar({ minLevel: 'X' });
    expect(screen.getByRole('button', { name: 'All levels' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    bar({ platform: 'ios', minLevel: 'W' });
    expect(screen.getByRole('button', { name: /^Error/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks for a level, for no level again when it is chosen, and for none from All', () => {
    const onChoose = vi.fn();
    const { rerender } = bar({ onChoose });
    fireEvent.click(screen.getByRole('button', { name: /^Warning/ }));
    expect(onChoose).toHaveBeenLastCalledWith('W');
    rerender(<LevelBar platform="android" counts={counts} minLevel="W" shown={1} total={2} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: /^Warning/ }));
    expect(onChoose).toHaveBeenLastCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: 'All levels' }));
    expect(onChoose).toHaveBeenLastCalledWith('');
  });

  it('says how many lines are shown', () => {
    bar();
    expect(screen.getByText('168 of 2,629 shown')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** — FAIL on the import.
- [ ] **Step 3: Write `LevelBar.tsx`** (`Button` variant `ghost`, size `sm`).
- [ ] **Step 4: Run it to make sure it passes** — 7 passed.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/LevelBar.tsx web/src/components/device-control/logcat/LevelBar.test.tsx
git commit -m "feat(web): a level bar with lines per level"
```

---

### Task 11: The details panel

**Files:**
- Create: `web/src/components/device-control/logcat/LogDetails.tsx`
- Test: `web/src/components/device-control/logcat/LogDetails.test.tsx`

**Interfaces:**
- Consumes: `levelName`, `formatTimeMs`, `LogPlatform`, `ui/button`.
- Produces: `interface LogDetailsProps { record: BufferedLogcatRecord; platform: LogPlatform; inBuffer: boolean; onCopyLine(): void; onCopyMessage(): void; onShowOnlyTag(): void; onHideTag(): void; onShowOnlyApp(): void; onClose(): void }`
  and `LogDetails`: a `section` named "Line details". Heading
  `"<Level name> · <tag>"`; a list of Time (`formatTimeMs`), App, Process ID,
  Thread ID; the whole message, selectable; the note "This line has left the
  buffer" when `!inBuffer`; buttons "Copy line", "Copy message", "Show only
  this tag", "Hide this tag", "Show only this app" (absent without a package;
  the two tag buttons absent without a tag); a × named "Close details". For
  Xenon's own record: heading "Added by Xenon", the text "Xenon added this
  line. It didn’t come from the phone.", the message, and "Copy line" only.
  UI strings use the typographic apostrophe (’), as the Actions tab does.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/device-control/logcat/LogDetails.test.tsx
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LogDetails, type LogDetailsProps } from './LogDetails';

const record = {
  seq: 1,
  ts: Date.UTC(2026, 7, 9, 16, 11, 0) + 123,
  pid: 1408,
  tid: 1409,
  level: 'E',
  tag: 'ActivityManager',
  pkg: 'com.android.systemui',
  message: 'ANR in com.android.systemui\nReason: input dispatching timed out',
};
const handlers = () => ({
  onCopyLine: vi.fn(),
  onCopyMessage: vi.fn(),
  onShowOnlyTag: vi.fn(),
  onHideTag: vi.fn(),
  onShowOnlyApp: vi.fn(),
  onClose: vi.fn(),
});
const panel = (over: Partial<LogDetailsProps> = {}) => {
  const h = handlers();
  render(<LogDetails record={record} platform="android" inBuffer {...h} {...over} />);
  return { h, section: screen.getByRole('region', { name: 'Line details' }) };
};

describe('LogDetails', () => {
  it('shows the whole line', () => {
    const { section } = panel();
    expect(within(section).getByRole('heading')).toHaveTextContent('Error · ActivityManager');
    expect(section).toHaveTextContent(/\d\d:\d\d:00\.123/);
    expect(section).toHaveTextContent('com.android.systemui');
    expect(section).toHaveTextContent('1408');
    expect(section).toHaveTextContent('1409');
    expect(section).toHaveTextContent('Reason: input dispatching timed out');
    expect(screen.queryByText('This line has left the buffer')).toBeNull();
  });

  it('runs each action', () => {
    const { h } = panel();
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
    click('Copy line');
    click('Copy message');
    click('Show only this tag');
    click('Hide this tag');
    click('Show only this app');
    click('Close details');
    Object.values(h).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
  });

  it('offers Show only this app only when the line has an app', () => {
    panel({ record: { ...record, pkg: undefined } });
    expect(screen.queryByRole('button', { name: 'Show only this app' })).toBeNull();
  });

  it('says when the line has left the buffer', () => {
    panel({ inBuffer: false });
    expect(screen.getByText('This line has left the buffer')).toBeInTheDocument();
  });

  it("says Xenon added its own line, and offers Copy line only", () => {
    panel({ record: { ...record, synthetic: true, level: 'W', tag: 'xenon', message: '3 lines dropped (slow client)' } });
    expect(screen.getByRole('heading')).toHaveTextContent('Added by Xenon');
    expect(screen.getByText('Xenon added this line. It didn’t come from the phone.')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual([
      'Close details',
      'Copy line',
    ]);
  });

  it('names Fault by its iOS name', () => {
    panel({ platform: 'ios', record: { ...record, level: 'F' } });
    expect(screen.getByRole('heading')).toHaveTextContent('Fault · ActivityManager');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** — FAIL on the import.
- [ ] **Step 3: Write `LogDetails.tsx`** (`section aria-label="Line details"`,
  the × first in the header, then the body; buttons `Button` variant
  `secondary` size `sm`).
- [ ] **Step 4: Run it to make sure it passes** — 6 passed.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/LogDetails.tsx web/src/components/device-control/logcat/LogDetails.test.tsx
git commit -m "feat(web): a details panel for one log line"
```

---

### Task 12: The toolbar

**Files:**
- Create: `web/src/components/device-control/logcat/LogToolbar.tsx`
- Test: `web/src/components/device-control/logcat/LogToolbar.test.tsx`

**Interfaces:**
- Consumes: `ui/button`, `ui/input`, `ui/Popover`, `ui/Menu` (Task 7), `formatCount`.
- Produces:
  - `type StreamStatus = 'Live' | 'Connecting' | 'Offline' | 'Denied'`
  - `interface LogToolbarProps { status: StreamStatus; statusDetail?: string | null; query: string; onQueryChange(query: string): void; filterRef: React.RefObject<HTMLInputElement>; find: string; onFindChange(find: string): void; findRef: React.RefObject<HTMLInputElement>; hitCount: number; activeHit: number; onStep(step: 1 | -1): void; following: boolean; onTogglePause(): void; recording: boolean; recordedLines: number; onToggleRecording(): void; onExport(): void; caseSensitive: boolean; onToggleCase(): void; wrap: boolean; onToggleWrap(): void; canCopySelected: boolean; onCopySelected(): void; onClearLines(): void }`
  - `LogToolbar`, left to right:
    - the status (`role="status"`, the dot `.log-live-dot` with `active` when
      Live and `is-error` when Offline or Denied, `title` = `statusDetail`);
    - the filter (`aria-label="Filter logs"`, placeholder
      `tag:Wifi package:com.example text`), with × "Clear filter" (only with
      text) and ? "Filter syntax", which opens a popover with:
      - "Terms are combined. Quote a value with spaces: `package:"Food Truck"`."
      - `tag:Wifi` "lines whose tag contains Wifi"
      - `package:com.example` "lines from that app"
      - `level:W` "warnings and above"
      - `-tag:chatty` "hide a tag"
      - "Other words search the message."
    - Find (`aria-label="Find in logs"`, placeholder "Find", count
      `"<i>/<n>"` in an `aria-live="polite"` span when it has text), then
      "Previous match" and "Next match" (disabled with no hits); Enter and
      Shift+Enter step.
    - a divider, then Pause / Resume, Record / `Stop · <n> lines`
      (`aria-pressed`, `is-recording`), the icon button "Export shown lines",
      and "More options" (`aria-haspopup="menu"`), whose menu has "Match
      case" and "Wrap long lines" (checkbox items), a divider, "Copy selected
      lines" (only when `canCopySelected`) and "Clear lines". Choosing an item
      closes the menu.
    - Buttons are `Button` variant `secondary` or `ghost`, size `sm` or
      `icon`; nothing is `btn-primary`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/device-control/logcat/LogToolbar.test.tsx
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LogToolbar, type LogToolbarProps } from './LogToolbar';

const props = (over: Partial<LogToolbarProps> = {}): LogToolbarProps => ({
  status: 'Live',
  query: '',
  onQueryChange: vi.fn(),
  filterRef: React.createRef(),
  find: '',
  onFindChange: vi.fn(),
  findRef: React.createRef(),
  hitCount: 0,
  activeHit: 0,
  onStep: vi.fn(),
  following: true,
  onTogglePause: vi.fn(),
  recording: false,
  recordedLines: 0,
  onToggleRecording: vi.fn(),
  onExport: vi.fn(),
  caseSensitive: false,
  onToggleCase: vi.fn(),
  wrap: true,
  onToggleWrap: vi.fn(),
  canCopySelected: false,
  onCopySelected: vi.fn(),
  onClearLines: vi.fn(),
  ...over,
});
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More options' }));

describe('LogToolbar', () => {
  it('shows the stream status in a live region, its dot red when it gave up', () => {
    const { container, rerender } = render(<LogToolbar {...props()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    expect(container.querySelector('.log-live-dot.active')).toBeTruthy();
    rerender(<LogToolbar {...props({ status: 'Offline' })} />);
    expect(container.querySelector('.log-live-dot.is-error')).toBeTruthy();
    rerender(<LogToolbar {...props({ status: 'Connecting' })} />);
    expect(container.querySelector('.log-live-dot.is-error')).toBeNull();
  });

  it('filters as you type, and × clears it only when there is text', () => {
    const p = props();
    const { rerender } = render(<LogToolbar {...p} />);
    expect(screen.getByLabelText('Filter logs')).toHaveAttribute('placeholder', 'tag:Wifi package:com.example text');
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:Wifi' } });
    expect(p.onQueryChange).toHaveBeenCalledWith('tag:Wifi');
    expect(screen.queryByLabelText('Clear filter')).toBeNull();
    rerender(<LogToolbar {...p} query="tag:Wifi" />);
    fireEvent.click(screen.getByLabelText('Clear filter'));
    expect(p.onQueryChange).toHaveBeenLastCalledWith('');
  });

  it('explains the filter syntax from the ? button', () => {
    render(<LogToolbar {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter syntax' }));
    const dialog = screen.getByRole('dialog');
    ['tag:Wifi', 'package:com.example', 'level:W', '-tag:chatty', 'hide a tag'].forEach((t) =>
      expect(dialog).toHaveTextContent(t),
    );
  });

  it('steps through matches with the buttons, Enter and Shift+Enter, and shows the count', () => {
    const p = props({ find: 'anr', hitCount: 12, activeHit: 2 });
    render(<LogToolbar {...p} />);
    expect(screen.getByText('3/12')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next match'));
    fireEvent.click(screen.getByLabelText('Previous match'));
    fireEvent.keyDown(screen.getByLabelText('Find in logs'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('Find in logs'), { key: 'Enter', shiftKey: true });
    expect((p.onStep as ReturnType<typeof vi.fn>).mock.calls).toEqual([[1], [-1], [1], [-1]]);
  });

  it('reports 0/0 and disables the steps with no match', () => {
    render(<LogToolbar {...props({ find: 'zzz' })} />);
    expect(screen.getByText('0/0')).toBeInTheDocument();
    expect(screen.getByLabelText('Next match')).toBeDisabled();
    expect(screen.getByLabelText('Previous match')).toBeDisabled();
  });

  it('reads Pause while following and Resume while paused', () => {
    const p = props();
    const { rerender } = render(<LogToolbar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(p.onTogglePause).toHaveBeenCalledTimes(1);
    rerender(<LogToolbar {...p} following={false} />);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('reads Stop with the line count while recording', () => {
    render(<LogToolbar {...props({ recording: true, recordedLines: 1204 })} />);
    const btn = screen.getByRole('button', { name: /Stop · 1,204 lines/ });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveClass('is-recording');
  });

  it('has an Export icon button that is never disabled', () => {
    const p = props();
    render(<LogToolbar {...p} />);
    const btn = screen.getByRole('button', { name: 'Export shown lines' });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(p.onExport).toHaveBeenCalledTimes(1);
  });

  it('toggles Match case and Wrap long lines from the menu', () => {
    const p = props({ caseSensitive: true });
    render(<LogToolbar {...p} />);
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Match case' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Match case' }));
    expect(p.onToggleCase).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap long lines' }));
    expect(p.onToggleWrap).toHaveBeenCalledTimes(1);
  });

  it('offers Copy selected lines only with a selection, and Clear lines', () => {
    const p = props();
    const { rerender } = render(<LogToolbar {...p} />);
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Copy selected lines' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear lines' }));
    expect(p.onClearLines).toHaveBeenCalledTimes(1);
    rerender(<LogToolbar {...p} canCopySelected />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy selected lines' }));
    expect(p.onCopySelected).toHaveBeenCalledTimes(1);
  });

  it('fills nothing green', () => {
    const { container } = render(<LogToolbar {...props()} />);
    expect(container.querySelector('.btn-primary')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** — FAIL on the import.
- [ ] **Step 3: Write `LogToolbar.tsx`** (icons from `lucide-react`: `X`,
  `HelpCircle`, `ArrowUp`, `ArrowDown`, `Pause`, `Play`, `Circle`, `Square`,
  `Download`, `MoreHorizontal`; focus the first menu item on open, as
  `AppsSection` does, and give focus back to "More options" on close).
- [ ] **Step 4: Run it to make sure it passes** — 11 passed.
- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-control/logcat/LogToolbar.tsx web/src/components/device-control/logcat/LogToolbar.test.tsx
git commit -m "feat(web): a one-row toolbar for the Logs tab"
```

---

### Task 13: `LogcatView` puts the parts together

**Files:**
- Modify: `web/src/components/device-control/logcat/LogcatView.tsx` (rewritten around the parts)
- Modify: `web/src/components/device-control/logcat/LogcatView.test.tsx`

**Interfaces:**
- Consumes: every task above; `useLogcatStream` (unchanged); `useToast`;
  `copyText` (`../actions/copyText`); `EmptyState`.
- Produces: `LogcatView({ udid, platform })`, same props. It owns `query`,
  `caseSensitive`, `wrap` (on), `find`, `hitIndex`, recording (as today),
  `following` (on) with `pausedAfter` (the buffer's last seq when it paused),
  `selection` and `details` (the record the panel shows, or null).
  - `visible = records.filter(matches(parsed))`; hits are positions in
    `visible` over `${tag} ${message}` as today; `newLines` = visible lines
    with seq above `pausedAfter`; the level bar counts
    `countLevels(records, parsed)`.
  - Find steps pause (`pause()`) and `listRef.current.reveal(hit)`.
  - Export: no shown lines → toast "No lines to export" (info), no download;
    otherwise as today, same file name and format.
  - Copy (Cmd/Ctrl+C in the list, "Copy selected lines", the panel's
    buttons) writes with `copyText`, falling back to a hidden textarea and
    `document.execCommand('copy')` (the clipboard API is missing on a plain
    http lab address); toasts "Copied 12 lines" / "Copied 1 line" / "Copied
    the line" / "Copied the message" (success) or "Your browser blocked
    copying here." (error).
  - The panel: Show only this tag = `withTerm(query, 'tag', tag)`, Hide this
    tag = `withExclusion(query, 'tag', tag)`, Show only this app =
    `withTerm(query, 'package', pkg)`. `inBuffer` = the record's seq is within
    the buffer's first and last seq.
  - Keys on the pane root (only for events from inside its own DOM, not a
    portal): `/` focuses the filter unless typing in a field; Cmd/Ctrl+F
    focuses Find; Esc closes the panel, or with it closed clears the
    selection.
  - States over the list: Connecting with no lines "Waiting for the phone’s
    first log line…"; Live with no lines "Connected. Lines appear here as the
    phone logs them."; lines but none shown: "No lines match" plus the filter
    in `<code>` and a "Clear filter" button. Denied and Offline banners above
    the list keep today's words ("Access denied — <reason>", "Connection lost
    after repeated attempts. Use Reconnect to try again.") in `role="alert"`,
    with "Reconnect" inside. Unsupported platform: `EmptyState` titled "Live
    logs are not available here", described "Live logs work on Android and
    iOS phones." (today's description named the tools; the copy rule wins).
  - Clear lines calls the hook's `clear()` and clears the selection.

- [ ] **Step 1: Rewrite the tests**

At the top of `LogcatView.test.tsx`: mock `../../ui/toast` (`useToast: () =>
({ toast, removeToast })` with a hoisted `toast = vi.fn()`), drop the global
`Element.prototype.scrollIntoView` stub, and in every `describe` install the
fake layout (`beforeEach(() => { layout = installFakeLayout({ viewportHeight: 600 }) })`,
`afterEach(() => layout.restore())`). Each of today's 36 tests stays, with
these changes:

| Today's test | Change |
|---|---|
| renders a record across its columns | PID and TID are in the panel now: click the row, then the panel shows `1408` twice (Process ID, Thread ID); tag, package and message are in the row |
| shows LIVE when connected and CONNECTING when not | read `getByRole('status')` |
| shows the visible / total counts | `2 of 2 shown` |
| marks synthetic records … | `.log-row.is-synthetic` |
| shows a terminal offline state with a manual reconnect | Reconnect is found inside the `role="alert"` banner |
| applies a level: term typed into the filter box … | counts `2 of 2 shown` / `1 of 2 shown` |
| keeps the dropdown and the filter box in agreement | the level bar: typing `level:E tag:Tile level:D` presses "Debug and above…"; clicking Warning writes `level:W tag:Tile`; clicking it again writes `tag:Tile`; All also writes `tag:Tile` |
| shows All levels for a level term that filters nothing | `level:X` presses All. `level:V` now presses Verbose (Verbose has a button now, and it shows every line): a rewritten half, listed in the PR |
| labels each level option for what it actually selects | the bar's names with an F line present: `All levels`, `Verbose and above, …`, …, `Fatal only, 1 fatal line` |
| keeps rendering records that arrive while frozen | Pause → the button reads Resume; the new line is in the list; `2 of 2 shown` |
| explains the exhausted state … / announces the denial banner … | `.log-banner.is-exhausted` / `.log-banner.is-denied`, `role="alert"` |
| reddens the status dot in a terminal state only | unchanged selector `.log-live-dot.is-error` |
| keeps a row DOM node across a front-trim | `.log-row` |
| keeps the EXPORT download alive | `getByRole('button', { name: 'Export shown lines' })` |
| clears the filter with the × button … | unchanged (`getByLabelText('Clear filter')` is the ×) |
| match case narrows the filter … | through More options → "Match case", `aria-checked` |
| next/prev, 0/0, Enter / Shift+Enter, find count | unchanged |
| stepping to a hit turns follow off | after Next match the button reads Resume |
| soft wrap is on by default and toggles … | More options → "Wrap long lines" `aria-checked`; the list gets `is-nowrap` |
| colours each tag from the tag itself | `.log-tag` |
| recording (6 tests) | `Stop · 2 lines` for the live count; the rest unchanged |

New tests in the same file (each its own `it`, in the describes above or a
new `describe('LogcatView — acting on lines')` with the same setup):

```tsx
  it('counts the levels that pass the filter, minus its level term', () => {
    mount([rec({ level: 'E', tag: 'Wifi' }), rec({ level: 'E', tag: 'Other' }), rec({ level: 'D', tag: 'Wifi' })]);
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:wifi level:E' } });
    expect(screen.getByRole('button', { name: 'Error and above, 1 error line' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Debug and above, 1 debug line' })).toBeInTheDocument();
  });

  it('on iOS, choosing Debug turns Debug on at the device, and Show only this app narrows it there', () => {
    mockStream.mockReturnValue(streamState({ records: [rec({ pkg: 'Food Truck' })] }));
    render(<LogcatView udid="DEV-1" platform="ios" />);
    fireEvent.click(screen.getByRole('button', { name: /^Debug and above/ }));
    expect(lastFilter().levels).toContain('Debug');
    fireEvent.click(document.querySelector('.log-row') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Show only this app' }));
    expect(screen.getByLabelText('Filter logs')).toHaveValue('level:D package:"Food Truck"');
    expect(lastFilter().process).toBe('Food Truck');
  });

  it('says there is nothing to export instead of saving an empty file', () => {
    mount([rec({ tag: 'Wifi' })]);
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export shown lines' }));
    expect(toast).toHaveBeenCalledWith('No lines to export', 'info');
  });

  it('opens a line in the panel and filters by its tag and app from there', () => {
    mount([rec({ tag: 'Wifi', pkg: 'com.a' }), rec({ tag: 'chatty', pkg: 'com.b' })]);
    fireEvent.click(screen.getByText('chatty').closest('.log-row') as HTMLElement);
    const box = screen.getByLabelText('Filter logs');
    // The panel keeps its line while the filter hides it.
    fireEvent.change(box, { target: { value: 'tag:Old level:W' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show only this tag' }));
    expect(box).toHaveValue('tag:chatty level:W');
    fireEvent.click(screen.getByRole('button', { name: 'Show only this app' }));
    expect(box).toHaveValue('tag:chatty level:W package:com.b');
    fireEvent.click(screen.getByRole('button', { name: 'Hide this tag' }));
    expect(box).toHaveValue('tag:chatty level:W package:com.b -tag:chatty');
  });

  it('copies the selected lines with Cmd/Ctrl+C, in list order, as Export writes them', async () => {
    const writeText = setClipboard();
    const lines = [rec({ message: 'one' }), rec({ message: 'two' }), rec({ message: 'three' })];
    mount(lines);
    fireEvent.click(screen.getByText('three').closest('.log-row') as HTMLElement);
    fireEvent.click(screen.getByText('one').closest('.log-row') as HTMLElement, { metaKey: true });
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Log lines' }), { key: 'c', metaKey: true });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Copied 2 lines', 'success'));
    expect(writeText).toHaveBeenCalledWith(`${formatLine(lines[0])}\n${formatLine(lines[2])}`);
  });

  it('offers Copy selected lines in the menu only with a selection', async () => {
    const writeText = setClipboard();
    mount([rec({ message: 'one' })]);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: 'Copy selected lines' })).toBeNull();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    fireEvent.click(screen.getByText('one').closest('.log-row') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy selected lines' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  });

  it('copies a line and its message from the panel', async () => {
    const writeText = setClipboard();
    const line = rec({ message: 'boom' });
    mount([line]);
    fireEvent.click(screen.getByText('boom').closest('.log-row') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Copy line' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(formatLine(line)));
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('boom'));
    expect(toast).toHaveBeenCalledWith('Copied the message', 'success');
  });

  it('Esc closes the panel, then clears the selection', () => {
    mount([rec({ message: 'one' })]);
    const row = screen.getByText('one').closest('.log-row') as HTMLElement;
    fireEvent.click(row);
    const list = screen.getByRole('listbox', { name: 'Log lines' });
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Line details' })).toBeNull();
    expect(row).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(row).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps the line in the panel after Clear lines, and says it left the buffer', () => {
    const clear = vi.fn();
    const line = rec({ message: 'kept' });
    mockStream.mockReturnValue(streamState({ records: [line], clear }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(screen.getByText('kept').closest('.log-row') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear lines' }));
    expect(clear).toHaveBeenCalledTimes(1);
    mockStream.mockReturnValue(streamState({ records: [], clear }));
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    const panel = screen.getByRole('region', { name: 'Line details' });
    expect(panel).toHaveTextContent('kept');
    expect(panel).toHaveTextContent('This line has left the buffer');
    expect(screen.getByText('0 of 0 shown')).toBeInTheDocument();
  });

  it('says what is happening when there are no lines', () => {
    mockStream.mockReturnValue(streamState({ connected: false }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('Waiting for the phone’s first log line…')).toBeInTheDocument();
    mockStream.mockReturnValue(streamState({ connected: true }));
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    expect(screen.getByText('Connected. Lines appear here as the phone logs them.')).toBeInTheDocument();
  });

  it('says no lines match the filter, and Clear filter clears it', () => {
    mount([rec()]);
    fireEvent.change(screen.getByLabelText('Filter logs'), { target: { value: 'tag:nope' } });
    expect(screen.getByText('tag:nope')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByLabelText('Filter logs')).toHaveValue('');
  });

  it('/ focuses the filter and Cmd/Ctrl+F focuses Find, from inside the pane', () => {
    mount([rec()]);
    const list = screen.getByRole('listbox', { name: 'Log lines' });
    list.focus();
    fireEvent.keyDown(list, { key: '/' });
    expect(document.activeElement).toBe(screen.getByLabelText('Filter logs'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'f', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Find in logs'));
    // Typing a slash into a field types a slash.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: '/' });
    expect(document.activeElement).toBe(screen.getByLabelText('Find in logs'));
  });

  it('Pause counts new lines in a pill, and Jump to latest follows again', () => {
    let records = [rec({ message: 'a' })];
    mockStream.mockImplementation(() => streamState({ records }));
    const { rerender } = render(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    records = [...records, rec({ message: 'b' }), rec({ message: 'c' })];
    rerender(<LogcatView udid="DEV-1" platform="android" />);
    fireEvent.click(screen.getByRole('button', { name: '2 new lines · Jump to latest' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('highlights the match in the row, and reaches a match that is not rendered', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => rec({ message: i === 100 ? 'needle here' : `line ${i}` }));
    mount(lines);
    await settle();
    fireEvent.change(screen.getByLabelText('Find in logs'), { target: { value: 'needle' } });
    fireEvent.keyDown(screen.getByLabelText('Find in logs'), { key: 'Enter' });
    await settle();
    expect(document.querySelector('.log-row.is-active-hit mark.log-mark')).toHaveTextContent('needle');
  });

  it('shows the shared empty state for a platform with no live logs', () => {
    const { container } = render(<LogcatView udid="DEV-1" platform="tvos" />);
    expect(container.querySelector('.empty-state')).toBeTruthy();
    expect(screen.queryByText(/logcat|os_trace/i)).toBeNull();
  });
```

Helpers to add at the top: `lastFilter = () => mockStream.mock.calls[mockStream.mock.calls.length - 1][2]`,
`setClipboard = () => { const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }); return writeText; }`
(and an `afterEach` in the describe that sets it back to `undefined`), and
`formatLine` imported from `./logcatRecording`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd web && npx vitest run src/components/device-control/logcat/LogcatView.test.tsx`
Expected: FAIL across the file (no level bar, no list roles, no toast).

- [ ] **Step 3: Rewrite `LogcatView.tsx`** around the parts. Drop the
  `Select`, `LEVEL_OPTIONS`, `LogcatRow` and the `scrollIntoView` follow
  effect. Keep `download()`, the recording effect and `toggleRecording` as
  they are. Keep `import './logcat.css'` and the `device-control.css` import
  for now (Task 14 replaces the sheet). Render:
  `.logcat-root` (root `onKeyDown`) → `LogToolbar` → `LevelBar` →
  `.log-body.theme-dark` (banners, `LogList`, the state message, `LogDetails`
  when open).

- [ ] **Step 4: Run the file, then the whole logcat folder**

Run: `cd web && npx vitest run src/components/device-control/logcat/`
Expected: all passing; `LogcatView.test.tsx` has 36 + 15 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
cd web && npx tsc --noEmit -p . && cd ..
git add web/src/components/device-control/logcat/LogcatView.tsx web/src/components/device-control/logcat/LogcatView.test.tsx
git commit -m "feat(web): the Logs tab uses the new toolbar, level bar, list and details"
```

---

### Task 14: Styles, the colour ratchet, and keys that never reach the phone

**Files:**
- Modify: `web/src/components/device-control/logcat/logcat.css` (rewritten)
- Modify: `web/src/components/device-control/logcat/LogcatView.tsx` (drop the `../device-control.css` import and its comment)
- Modify: `web/src/design/color-literals.baseline.json` (remove the `logcat.css` entry)
- Modify: `web/src/components/device-control/device-control.test.tsx`
- Modify: `web/test/viewport/overflow.spec.ts`

**Interfaces:**
- Consumes: the class names from Tasks 8–13.

- [ ] **Step 1: Write the failing device-control test**

In `device-control.test.tsx`: replace `vi.mock('./logcat/LogcatView', …)` with
`vi.mock('./logcat/useLogcatStream', () => ({ useLogcatStream: () => ({ records: LOG_LINES, connected: true, clear: () => {}, deniedReason: null, exhausted: false, retry: () => {} }) }))`
(`LOG_LINES` hoisted: three records), add `typeText` and `pressKey`
(resolving) to the hoisted `api`, and add:

```tsx
describe('DeviceControl — the Logs pane keeps keys off the phone', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout();
  });
  afterEach(() => layout.restore());

  it('sends no text and no key event for keys pressed in the Logs pane', async () => {
    open(S9, 'logs');
    const canvas = document.querySelector('.device-stream-canvas') as HTMLElement;
    // The control: with the device screen focused, a key does reach the phone.
    act(() => canvas.focus());
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(api.pressKey).toHaveBeenCalledTimes(1);
    api.pressKey.mockClear();

    const list = screen.getByRole('listbox', { name: 'Log lines' });
    act(() => list.focus());
    ['a', 'Enter', 'Backspace', 'ArrowDown', 'ArrowUp', 'End', 'Escape'].forEach((key) =>
      fireEvent.keyDown(list, { key }),
    );
    fireEvent.keyDown(list, { key: '/' }); // focuses the filter
    const filter = screen.getByLabelText('Filter logs');
    fireEvent.keyDown(filter, { key: 'x' });
    fireEvent.keyDown(filter, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 120)); // past the 50 ms typing buffer
    expect(api.typeText).not.toHaveBeenCalled();
    expect(api.pressKey).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it** — `cd web && npx vitest run src/components/device-control/device-control.test.tsx`.
  Expected: PASS (device control already gates keys on `isCanvasFocused`;
  the test holds that). If it fails, the fix belongs in the Logs pane, not in
  `device-control.tsx`'s gate.

- [ ] **Step 3: Rewrite `logcat.css` and drop the borrowed sheet**

Sections, all in role tokens, no hex or `rgba()`:
- `.logcat-root`: flex column, `flex: 1`, `min-height: 0`, `container: log-pane / inline-size`.
- `.log-toolbar`: one row (`flex-wrap: wrap` only so a 450 px panel takes
  two rows instead of overflowing), 6px 8px padding, 6px gap, the surface
  wash it has today. `.log-status` pill with `.log-live-dot` (`active` pulse,
  `is-error` in `--color-danger`). `.log-filter` takes the free width
  (`flex: 1 1 160px`, `min-width: 120px`), its `Input` 28 px high with room
  for × and ?. `.log-find` 110 px with `.log-find-count` inside.
  `.log-toolbar-divider` 1 px `--border`. `.btn-base.is-recording` in
  `--color-danger` (text, a 45% border, a 12% tint, filled icon).
- `.log-levels`: about 28 px, `.log-level-btn` ghost buttons, `is-included`
  `rgb(var(--rgb-fg) / 0.06)`, `[aria-pressed='true']` a `--border-strong`
  border, error and fatal counts in `--color-danger`, `.log-shown` pushed
  right, muted.
- `.log-body`: the island (`theme-dark` in the markup), flex column, relative;
  in the light theme `background: var(--bg)`.
- `.log-banner.is-denied` / `.is-exhausted`: `--color-danger` /
  `--color-warning` tints and borders by `color-mix`, text `var(--text)`.
- `.log-list`: `flex: 1`, `overflow-y: auto`, `overflow-anchor: none`,
  JetBrains Mono 11.5 px, focus ring `--color-focus-ring`. `.log-list-sizer`
  relative, full width.
- `.log-row`: absolute, `top: 0; left: 0; width: 100%`, padding 1px 8px,
  line-height 18 px; two lines by default: `grid-template-columns: 62px 18px minmax(0, 140px) minmax(0, 1fr)`,
  `.log-msg` on its own line (`grid-column: 2 / -1`). At
  `@container log-pane (min-width: 720px)`: `62px 18px minmax(0, 140px) minmax(0, 150px) minmax(0, 1fr)`,
  message back on the line. Time, tag and package ellipsised. Wrap on:
  message `pre-wrap` + `overflow-wrap: anywhere`; `.log-list.is-nowrap`:
  `pre`, hidden overflow, ellipsis.
- Levels: `.lvl-E`, `.lvl-F` rows a `--color-danger` 10% tint and
  `box-shadow: inset 2px 0 0 var(--color-danger)`; badges: W amber
  (`--color-warning` text on its 18% tint), E/F `--color-danger`, I
  `--color-info`, V/D `--text-muted` (and V/D messages muted).
- Selected `[aria-selected='true']` a `--color-highlight` 20% tint;
  `.log-list:focus .log-row.is-active` a 1 px `--color-focus-ring` outline;
  `.is-hit` a `--color-warning` 8% tint, `.is-active-hit` a 1 px
  `--color-warning` outline; `mark.log-mark` a `--color-warning` 40% tint,
  `color: inherit`.
- `.is-synthetic`: message `grid-column: 3 / -1`, `--color-warning`, italic.
- `.log-new-pill` absolute at the bottom centre of `.log-list-wrap`;
  `.log-dropped-note` a thin muted row above the list; `.log-state` centred
  over the list (muted text, `code`, the Clear filter button).
- `.log-details`: `max-height: 40%`, `overflow: auto`, top border, the
  message `pre-wrap` and selectable.
- The pulse and every transition already stop under
  `prefers-reduced-motion` (the global rule in `tokens.css`); nothing here
  scrolls smoothly.

Remove `import '../device-control.css'` and its comment from `LogcatView.tsx`.

- [ ] **Step 4: Run the colour ratchet to watch it fail on the stale entry**

Run: `cd web && npx vitest run src/design/color-literals.test.ts`
Expected: FAIL, "the baseline has no stale headroom":
`src/components/device-control/logcat/logcat.css: now 0, baseline says 3`.

- [ ] **Step 5: Remove that entry from `color-literals.baseline.json` and run it again** — PASS.

- [ ] **Step 6: Write the Playwright viewport cases (not run here)**

In `web/test/viewport/overflow.spec.ts`:
- Add `const LOGS_ROUTE = '/xenon/devices/MOCK-ANDROID-01/control/logs';` to
  `ROUTES` and a `mockLogStream(page)` that answers
  `**/xenon/api/control/*/stream/ticket` with `{ ticket: 'mock-ticket' }` and
  `page.routeWebSocket(/\/logcat\?ticket=/, (ws) => …)` sending 400 records
  (every level, a few Xenon records, tags and packages over 60 characters,
  messages over 300 characters) as JSON frames.
- `ROUTE_DATA_MOCKS[LOGS_ROUTE] = mockLogStream` and a
  `ROUTE_CONTENT_CHECKS[LOGS_ROUTE]` that expects
  `page.getByRole('listbox', { name: 'Log lines' }).getByRole('option')` not
  to have count 0 and the "Log levels" group to be visible.
- A test `no overflow on the Logs tab with a landscape phone at 1280px`: set
  the viewport to 1280 × 900, mock, open `LOGS_ROUTE`, click
  `.footer-action-btn[aria-label="Landscape orientation"]`, assert the
  `.logcat-root` box is at most 480 px wide (the narrow panel really is under
  test), that options rendered, and run the same both-edges rect scan as the
  landscape test.
- Leave the account-menu loop's `!r.includes('/control')` filter as it is.

- [ ] **Step 7: Run the whole web suite and the typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit -p .`
Expected: every file passes; tsc exit 0. Check the output for jsdom "Could
not parse CSS stylesheet" errors from the `@container` rules and fix any.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/device-control/logcat/logcat.css web/src/components/device-control/logcat/LogcatView.tsx web/src/design/color-literals.baseline.json web/src/components/device-control/device-control.test.tsx web/test/viewport/overflow.spec.ts
git commit -m "feat(web): Logs tab styles in role tokens; keys in the pane never reach the phone"
```

---

### Task 15: Checks and push

- [ ] **Step 1: The web suite** — `cd web && npx vitest run`. Expected: all
  files pass; record the file and test counts (baseline before this branch:
  133 files, 1,158 tests).
- [ ] **Step 2: The typecheck** — `cd web && npx tsc --noEmit -p .`, exit 0.
- [ ] **Step 3: The dashboard build** — `npm run build:xenon` from the repo
  root, ends with "Xenon build complete."
- [ ] **Step 4: Lint and format the changed files only.** Link the main
  checkout's root `node_modules` into this worktree if it has none, run
  `npx eslint <each changed .ts/.tsx>` and `npx prettier --check <each changed file>`,
  fix by hand (never `--fix` over the repo), compare ESLint counts per file
  against `main` for files that existed there, and remove the link after.
- [ ] **Step 5: Push** — `git push origin HEAD:feat/logs-tab-redesign`. No pull
  request.

---

## Local tasks (need a server, a browser or the phones)

- [ ] **L1. Viewport spec.** Rebuild (`npm run build:all`), start a server with
  the dashboard on and auth off, then `cd web && npm run test:viewport`.
  Expected: every case passes, the Logs route at 1280–1440 and the landscape
  450 px panel included. Fix the mock if `routeWebSocket` needs an explicit
  open before `send`.
- [ ] **L2. Control sweep** (`npm run test:sweep`, about 20 minutes). Every new
  control must do something; a legitimate no-op (for example Jump to latest
  with nothing new) gets an `EXPECTED_NO_EFFECT` entry with its reason in
  `web/test/sweep/controls.spec.ts`.
- [ ] **L3. Light-theme contrast** on the Logs tab (toolbar, level bar,
  banners, the island's rows and the details panel), plus dark at Playwright
  `threshold: 0` for the rest of device control.
- [ ] **L4. Galaxy S9+, as a user, on a rebuilt server:** about 35 lines at
  1440; scrolling up pauses and the pill counts; the reading place holds after
  the buffer passes 5,000; every details action; Cmd/Ctrl+C and the menu copy
  (also from a plain http lab address); the 720 px switch by turning the phone
  to landscape; Export and Record files match today's format byte for byte in
  layout.
- [ ] **L5. An iPhone:** the iOS level bar; Debug turned on at the device (the
  line rate jumps); "Show only this app" narrowing at the source.
- [ ] **L6. Performance:** on today's build first, then this one, on the S9+
  with a full 5,000-line buffer, one minute each, a `PerformanceObserver` for
  `longtask`: the longest render per 50 ms update and the long tasks over 50 ms.
  Target: none. Both sets of numbers go in the PR.
- [ ] **L7. The PR:** one PR from `feat/logs-tab-redesign`, listing the
  rewritten and any removed `LogcatView` tests with reasons, the numbers from
  L6, and screenshots in both themes at 1440 and with a landscape phone.
