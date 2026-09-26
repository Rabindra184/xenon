# Device control Actions tab redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Actions tab's four cards with three sections: Apps (install from the library or a file, and a searchable installed list), Text and clipboard, and Swipe. They live in `device-control/actions/`.

**Architecture:**
- Pure rules (`appsList.ts`, `swipe.ts`, `copyText.ts`), each tested directly.
- Three section components that own their state and API calls, and a thin `ActionsPanel` that lays them out and performs swipes.
- `device-control.tsx` renders `<ActionsPanel/>` and drops about 250 lines of Actions state, handlers, markup and the uninstall dialog.

**Tech Stack:** React 17, the shared `ui/button`, `ui/Popover`, `ui/Menu` and `ui/Modal`, lucide-react, Vitest + Testing Library, and Playwright (the threshold-0 harness in `scratchpad/dcshots`).

Spec: `docs/superpowers/specs/2026-09-26-actions-tab-redesign-design.md`

## Global Constraints

- Buttons are the shared `Button`, with sentence-case labels. At most one `tonal` button per section.
- Every message uses `failed(what, err)` / `clipboardError(platform, err)` from `../actionMessages` and names the device (`deviceName`), never the UDID.
- Library matching: android → `platform === 'android'`; ios or tvos → `platform === 'ios'`; anything else → none.
- Upload `accept`: `.apk` on Android, else `.ipa,.app`.
- Copying goes through `copyText(text)`. On `false`, select the text and toast `COPY_BLOCKED` ("Your browser blocked copying here. The text is selected, so press ⌘C or Ctrl+C.").
- No raw colour literals, and no stylesheet rule that starts with a shared Button class (`src/design/button-classes.test.ts`).
- The Screenshot and Logs tabs stay pixel-identical (baseline captured on main in `scratchpad/dcshots`: 26 captures).
- Never run `eslint --fix` on whole files. Compare lint counts with main. Stage explicit paths. Never confirm a real uninstall during live checks.

**Two adjustments to the spec, made here on purpose:**
- **Names follow their visible labels** (WCAG 2.5.3, Label in Name): the fields are named "Send text" and "Clipboard", not "Text to send to the device" or "Device clipboard".
- **The Upload file control is a `Button`** that opens a `hidden` file input, rather than an `sr-only` input inside a label. The keyboard reaches the Button, and a `hidden` input still opens when clicked programmatically.

---

### Task 1: Pure rules

**Files:**
- Create: `web/src/components/device-control/actions/appsList.ts`, `…/actions/swipe.ts`, `…/actions/copyText.ts`
- Test: `…/actions/appsList.test.ts`, `…/actions/swipe.test.ts`, `…/actions/copyText.test.ts`

**Interfaces (produces):**
- `interface LibraryApp { id: string; name: string; platform?: string | null; version?: string | null; packageName?: string | null }`
- `filterApps(apps: string[], query: string): string[]`
- `looksLikePackageId(text: string): boolean`
- `libraryAppsFor(library: LibraryApp[], platform: string | undefined): LibraryApp[]`
- `libraryNote(app: Pick<LibraryApp, 'version' | 'packageName'>): string`
- `platformNoun(platform: string | undefined): 'Android' | 'iOS'`
- `uploadAccept(platform: string | undefined): string`
- `type SwipeDirection = 'up' | 'down' | 'left' | 'right'`
- `swipePath(d: SwipeDirection, width: number, height: number): { startX: number; startY: number; endX: number; endY: number }`
- `copyText(text: string): Promise<boolean>`; `COPY_BLOCKED: string`

- [ ] **Step 1: Write the failing tests.**

`appsList.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  filterApps,
  libraryAppsFor,
  libraryNote,
  looksLikePackageId,
  platformNoun,
  uploadAccept,
  type LibraryApp,
} from './appsList';

describe('filterApps', () => {
  const apps = ['com.samsung.notes', 'com.google.docs', 'io.appium.settings'];

  it('sorts, and an empty query returns everything', () => {
    expect(filterApps(apps, '')).toEqual(['com.google.docs', 'com.samsung.notes', 'io.appium.settings']);
    expect(filterApps(apps, '   ')).toHaveLength(3);
  });

  it('matches a substring, ignoring case', () => {
    expect(filterApps(apps, 'GOOGLE')).toEqual(['com.google.docs']);
    expect(filterApps(apps, 'set')).toEqual(['io.appium.settings']);
    expect(filterApps(apps, 'nothing')).toEqual([]);
  });
});

describe('looksLikePackageId', () => {
  it('accepts Android packages and iOS bundle ids', () => {
    for (const id of ['com.foo.bar', 'io.appium.settings', 'com.example.my-app', ' com.foo ']) {
      expect(looksLikePackageId(id)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const id of ['foo', 'com foo', '.foo', 'com..foo', '1com.foo', 'com.', '']) {
      expect(looksLikePackageId(id)).toBe(false);
    }
  });
});

describe('libraryAppsFor', () => {
  const lib: LibraryApp[] = [
    { id: 'a', name: 'Shop', platform: 'android' },
    { id: 'i', name: 'Shop', platform: 'ios' },
    { id: 'x', name: 'Other', platform: null },
  ];

  it('gives Android devices Android builds, iOS and tvOS the iOS builds', () => {
    expect(libraryAppsFor(lib, 'android').map((a) => a.id)).toEqual(['a']);
    expect(libraryAppsFor(lib, 'ios').map((a) => a.id)).toEqual(['i']);
    expect(libraryAppsFor(lib, 'tvos').map((a) => a.id)).toEqual(['i']);
    expect(libraryAppsFor(lib, 'windows')).toEqual([]);
  });
});

describe('libraryNote, platformNoun, uploadAccept', () => {
  it('joins what is known', () => {
    expect(libraryNote({ version: '2.1', packageName: 'com.shop' })).toBe('2.1 · com.shop');
    expect(libraryNote({ version: '2.1', packageName: null })).toBe('2.1');
    expect(libraryNote({ version: null, packageName: 'com.shop' })).toBe('com.shop');
    expect(libraryNote({})).toBe('');
  });

  it('names the platform and the files it installs', () => {
    expect(platformNoun('android')).toBe('Android');
    expect(platformNoun('tvos')).toBe('iOS');
    expect(uploadAccept('android')).toBe('.apk');
    expect(uploadAccept('ios')).toBe('.ipa,.app');
  });
});
```

`swipe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { swipePath } from './swipe';

// The old D-pad's geometry: through the centre, across 80% of the screen.
describe('swipePath', () => {
  it('moves the content the way it names', () => {
    expect(swipePath('up', 1000, 2000)).toEqual({ startX: 500, startY: 1800, endX: 500, endY: 200 });
    expect(swipePath('down', 1000, 2000)).toEqual({ startX: 500, startY: 200, endX: 500, endY: 1800 });
    expect(swipePath('left', 1000, 2000)).toEqual({ startX: 900, startY: 1000, endX: 100, endY: 1000 });
    expect(swipePath('right', 1000, 2000)).toEqual({ startX: 100, startY: 1000, endX: 900, endY: 1000 });
  });

  it('rounds to whole pixels', () => {
    const p = swipePath('up', 1081, 2221);
    for (const v of Object.values(p)) expect(Number.isInteger(v)).toBe(true);
  });
});
```

`copyText.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copyText';

const setClipboard = (value: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

describe('copyText', () => {
  afterEach(() => setClipboard(undefined));

  it('is true when the browser wrote it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    expect(await copyText('com.foo')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('com.foo');
  });

  // Plain http on a LAN address has no clipboard API.
  it('is false when copying is blocked or unavailable', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    expect(await copyText('x')).toBe(false);
    setClipboard(undefined);
    expect(await copyText('x')).toBe(false);
  });
});
```

- [ ] **Step 2: Watch them fail.** Run `cd web && npx vitest run src/components/device-control/actions/`. Expected: FAIL, the modules don't exist.

- [ ] **Step 3: Implement.**

`appsList.ts`:

```ts
/** A build in the Apps library, as GET /apps returns it (the fields read here). */
export interface LibraryApp {
  id: string;
  name: string;
  platform?: string | null;
  version?: string | null;
  packageName?: string | null;
}

/** Sorted, then filtered by a case-insensitive substring. */
export function filterApps(apps: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return [...apps].sort((a, b) => a.localeCompare(b)).filter((a) => !q || a.toLowerCase().includes(q));
}

// Android packages and iOS bundle ids: dot-separated, starting with a letter.
// Bundle ids may hold hyphens (com.example.my-app).
const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/;

/** Whether typed text could be a package the list doesn't show (system apps). */
export function looksLikePackageId(text: string): boolean {
  return PACKAGE_ID.test(text.trim());
}

function libraryPlatform(platform: string | undefined): 'android' | 'ios' | null {
  const p = (platform || '').toLowerCase();
  if (p === 'android') return 'android';
  if (p === 'ios' || p === 'tvos') return 'ios';
  return null;
}

/** Android devices take Android builds; iOS and tvOS take the library's iOS builds. */
export function libraryAppsFor(library: LibraryApp[], platform: string | undefined): LibraryApp[] {
  const want = libraryPlatform(platform);
  return want ? library.filter((a) => (a.platform || '').toLowerCase() === want) : [];
}

/** "2.1 · com.shop", leaving out what the library doesn't know. */
export function libraryNote(app: Pick<LibraryApp, 'version' | 'packageName'>): string {
  return [app.version, app.packageName].filter(Boolean).join(' · ');
}

export function platformNoun(platform: string | undefined): 'Android' | 'iOS' {
  return libraryPlatform(platform) === 'android' ? 'Android' : 'iOS';
}

/** What the file chooser offers: the builds this device can install. */
export function uploadAccept(platform: string | undefined): string {
  return libraryPlatform(platform) === 'android' ? '.apk' : '.ipa,.app';
}
```

`swipe.ts`:

```ts
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * A swipe through the screen's centre across 80% of it, as the old D-pad sent.
 * "up" moves the content up: the finger goes from low to high.
 */
export function swipePath(direction: SwipeDirection, width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const dx = width * 0.4;
  const dy = height * 0.4;
  const [startX, startY, endX, endY] = {
    up: [cx, cy + dy, cx, cy - dy],
    down: [cx, cy - dy, cx, cy + dy],
    left: [cx + dx, cy, cx - dx, cy],
    right: [cx - dx, cy, cx + dx, cy],
  }[direction].map(Math.round);
  return { startX, startY, endX, endY };
}
```

`copyText.ts`:

```ts
export const COPY_BLOCKED =
  'Your browser blocked copying here. The text is selected, so press ⌘C or Ctrl+C.';

/**
 * Copies to the user's own clipboard. The clipboard API exists only on secure
 * origins (https, localhost); a lab dashboard on http://<lan-ip> has none, so
 * callers fall back to selecting the text when this returns false.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** the six files: `feat(device-control): Actions rules — app search, package ids, library matching, swipe paths, copying`.

### Task 2: `SwipeRow` and `TextClipboardSection`

**Files:**
- Create: `…/actions/SwipeRow.tsx`, `…/actions/TextClipboardSection.tsx`, `…/actions/actions.css`
- Test: `…/actions/SwipeRow.test.tsx`, `…/actions/TextClipboardSection.test.tsx`

**Interfaces:**
- Consumes: `SwipeDirection`, `copyText`, `COPY_BLOCKED` (Task 1); `failed` and `clipboardError` from `../actionMessages`.
- Produces: `SwipeRow({ onSwipe }: { onSwipe: (d: SwipeDirection) => void })` and `TextClipboardSection({ udid, platform }: { udid: string; platform: string })`.

- [ ] **Step 1: Write the failing tests.**

`SwipeRow.test.tsx`:

```tsx
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SwipeRow } from './SwipeRow';

describe('SwipeRow', () => {
  it('offers four named swipes', () => {
    const onSwipe = vi.fn();
    render(<SwipeRow onSwipe={onSwipe} />);
    for (const d of ['up', 'down', 'left', 'right']) {
      fireEvent.click(screen.getByRole('button', { name: `Swipe ${d}` }));
      expect(onSwipe).toHaveBeenLastCalledWith(d);
    }
  });
});
```

`TextClipboardSection.test.tsx`:

```tsx
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ typeText: vi.fn(), getClipboard: vi.fn(), setClipboard: vi.fn() }));
const toast = vi.hoisted(() => vi.fn(() => 't'));
vi.mock('../../../api-service', () => ({ default: api }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
const copy = vi.hoisted(() => ({ ok: true }));
vi.mock('./copyText', async (orig) => ({
  ...(await orig<typeof import('./copyText')>()),
  copyText: vi.fn(async () => copy.ok),
}));

import { TextClipboardSection } from './TextClipboardSection';

const errors = () => toast.mock.calls.filter((c) => (c as unknown[])[1] === 'error').map((c) => (c as unknown[])[0]);
const U = 'U1';
const render$ = (platform = 'android') => render(<TextClipboardSection udid={U} platform={platform} />);

beforeEach(() => {
  vi.clearAllMocks();
  copy.ok = true;
  api.typeText.mockResolvedValue({});
  api.getClipboard.mockResolvedValue({ content: 'hello' });
  api.setClipboard.mockResolvedValue({ success: true });
});

describe('Send text', () => {
  it('sends with the button or Enter, then says Sent', async () => {
    render$();
    const field = screen.getByRole('textbox', { name: 'Send text' });
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.typeText).toHaveBeenCalledWith(U, 'abc'));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent');
    expect(field).toHaveValue('');
    fireEvent.change(field, { target: { value: 'def' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(api.typeText).toHaveBeenLastCalledWith(U, 'def'));
  });

  it('keeps the text and says why when sending fails', async () => {
    api.typeText.mockRejectedValue(new Error('no focused field'));
    render$();
    const field = screen.getByRole('textbox', { name: 'Send text' });
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(errors()).toContain('Couldn’t send the text: no focused field'));
    expect(field).toHaveValue('abc');
  });
});

describe('Clipboard', () => {
  it('reads the device clipboard into the field', async () => {
    render$();
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Clipboard' })).toHaveValue('hello'));
  });

  it('says when the device clipboard is empty', async () => {
    api.getClipboard.mockResolvedValue({ content: '' });
    render$();
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The device clipboard is empty');
  });

  it('uses the platform’s own error when reading fails', async () => {
    api.getClipboard.mockRejectedValue(new Error('WDA is not running'));
    render$('ios');
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    await waitFor(() => expect(errors()).toContain('Couldn’t read the clipboard: WDA is not running'));
  });

  it('writes the field to the device, only when there is text', async () => {
    render$();
    const write = screen.getByRole('button', { name: 'Write to device' });
    expect(write).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Clipboard' }), { target: { value: 'token-123' } });
    fireEvent.click(write);
    await waitFor(() => expect(api.setClipboard).toHaveBeenCalledWith(U, 'token-123'));
    expect(await screen.findByRole('status')).toHaveTextContent('Written to the device');
  });

  it('says why writing failed', async () => {
    api.setClipboard.mockRejectedValue(new Error('denied'));
    render$();
    fireEvent.change(screen.getByRole('textbox', { name: 'Clipboard' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write to device' }));
    await waitFor(() => expect(errors()).toContain('Couldn’t write the clipboard: denied'));
  });

  it('copies to your clipboard, and selects the text when the browser blocks it', async () => {
    render$();
    const field = screen.getByRole('textbox', { name: 'Clipboard' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy clipboard text' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    copy.ok = false;
    const select = vi.spyOn(field, 'select');
    fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('blocked copying'), 'info');
  });
});
```

- [ ] **Step 2: Watch them fail.** Run `cd web && npx vitest run src/components/device-control/actions/`. Expected: FAIL for the new files.

- [ ] **Step 3: Implement.**

`SwipeRow.tsx`:

```tsx
import * as React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand } from 'lucide-react';
import { Button } from '../../ui/button';
import type { SwipeDirection } from './swipe';

const SWIPES: { direction: SwipeDirection; Icon: typeof ArrowUp }[] = [
  { direction: 'up', Icon: ArrowUp },
  { direction: 'down', Icon: ArrowDown },
  { direction: 'left', Icon: ArrowLeft },
  { direction: 'right', Icon: ArrowRight },
];

/**
 * Swipes by button. Dragging on the live screen needs a mouse, so these keep
 * swiping open to keyboard and screen-reader users; one line instead of the
 * old 230px D-pad.
 */
export function SwipeRow({ onSwipe }: { onSwipe: (direction: SwipeDirection) => void }) {
  return (
    <section className="actions-section actions-swipe" aria-labelledby="actions-swipe-title">
      <h4 id="actions-swipe-title" className="actions-section-title">
        <Hand size={15} aria-hidden="true" /> Swipe
      </h4>
      <div className="actions-swipe-buttons">
        {SWIPES.map(({ direction, Icon }) => (
          <Button
            key={direction}
            variant="secondary"
            size="icon"
            aria-label={`Swipe ${direction}`}
            title={`Swipe ${direction}`}
            onClick={() => onSwipe(direction)}
          >
            <Icon size={14} aria-hidden="true" />
          </Button>
        ))}
      </div>
    </section>
  );
}
```

`TextClipboardSection.tsx`:

```tsx
import * as React from 'react';
import { Check, Copy, Keyboard, Loader2 } from 'lucide-react';
import XenonApiService from '../../../api-service';
import { Button } from '../../ui/button';
import { useToast } from '../../ui/toast';
import { clipboardError, failed } from '../actionMessages';
import { COPY_BLOCKED, copyText } from './copyText';

interface Props {
  udid: string;
  platform: string;
}

/** Typing into the phone's focused field, and its clipboard both ways. */
export function TextClipboardSection({ udid, platform }: Props) {
  const { toast } = useToast();
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [clip, setClip] = React.useState('');
  const [busy, setBusy] = React.useState<'read' | 'write' | null>(null);
  const [status, setStatus] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const clipRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(''), 2000);
    return () => clearTimeout(t);
  }, [status]);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await XenonApiService.typeText(udid, text);
      setText('');
      setStatus('Sent');
    } catch (err) {
      toast(failed('send the text', err), 'error');
    } finally {
      setSending(false);
    }
  };

  const read = async () => {
    setBusy('read');
    try {
      const result = await XenonApiService.getClipboard(udid);
      const content = typeof result?.content === 'string' ? result.content : '';
      setClip(content);
      if (!content) setStatus('The device clipboard is empty');
    } catch (err) {
      toast(clipboardError(platform, err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const write = async () => {
    if (!clip) return;
    setBusy('write');
    try {
      await XenonApiService.setClipboard(udid, clip);
      setStatus('Written to the device');
    } catch (err) {
      toast(failed('write the clipboard', err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (await copyText(clip)) {
      setCopied(true);
      return;
    }
    clipRef.current?.select();
    toast(COPY_BLOCKED, 'info');
  };

  return (
    <section className="actions-section" aria-labelledby="actions-text-title">
      <h4 id="actions-text-title" className="actions-section-title">
        <Keyboard size={15} aria-hidden="true" /> Text and clipboard
      </h4>
      <div className="actions-field-row">
        <label className="actions-field-label" htmlFor="actions-send-text">
          Send text
        </label>
        <input
          id="actions-send-text"
          type="text"
          className="type-input-field compact"
          placeholder="Type text for the focused field…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button variant="secondary" size="sm" onClick={send} disabled={!text.trim() || sending}>
          {sending && <Loader2 className="animate-spin" size={13} aria-hidden="true" />}
          Send
        </Button>
      </div>
      <div className="actions-field-row">
        <label className="actions-field-label" htmlFor="actions-clipboard">
          Clipboard
        </label>
        <input
          id="actions-clipboard"
          ref={clipRef}
          type="text"
          className="type-input-field compact"
          placeholder="Read the device clipboard, or type text to write"
          value={clip}
          onChange={(e) => setClip(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={read} disabled={busy !== null}>
          {busy === 'read' && <Loader2 className="animate-spin" size={13} aria-hidden="true" />}
          Read
        </Button>
        <Button variant="secondary" size="sm" onClick={write} disabled={!clip || busy !== null}>
          {busy === 'write' && <Loader2 className="animate-spin" size={13} aria-hidden="true" />}
          Write to device
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? 'Copied' : 'Copy clipboard text'}
          title={copied ? 'Copied' : 'Copy to your clipboard'}
          onClick={copy}
          disabled={!clip}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </Button>
      </div>
      <p className="actions-status" role="status">
        {status}
      </p>
    </section>
  );
}
```

`actions.css`: the whole file is in Task 4, Step 3. For this task, create it with the section rules that Task 4 lists (`.actions-panel` through `.actions-status`), so these components render styled.

- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** the five files: `feat(device-control): Swipe row and Text and clipboard section`.

### Task 3: `AppsSection`

**Files:**
- Create: `…/actions/AppsSection.tsx`
- Test: `…/actions/AppsSection.test.tsx`
- Modify: `…/actions/actions.css` (the apps rules in Task 4, Step 3)

**Interfaces:**
- Consumes: everything in Task 1; `failed` from `../actionMessages`; `Popover`, `Menu`/`MenuItem`, `Modal` and `Button`; `useNavigate`.
- Produces: `AppsSection({ udid, platform, deviceName }: { udid: string; platform: string; deviceName: string })`.

- [ ] **Step 1: Write the failing tests.**

```tsx
import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listApps: vi.fn(),
  getApps: vi.fn(),
  installRepositoryApp: vi.fn(),
  uploadAndInstallApp: vi.fn(),
  uninstallApp: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn(() => 't'));
vi.mock('../../../api-service', () => ({ default: api }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));
const copy = vi.hoisted(() => ({ ok: true }));
vi.mock('./copyText', async (orig) => ({
  ...(await orig<typeof import('./copyText')>()),
  copyText: vi.fn(async () => copy.ok),
}));

import { AppsSection } from './AppsSection';

const U = '381103b720057ece';
const told = (tone: string) =>
  toast.mock.calls.filter((c) => (c as unknown[])[1] === tone).map((c) => (c as unknown[])[0]);

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
const open = (platform = 'android') =>
  render(
    <MemoryRouter initialEntries={['/devices/x/control/actions']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <AppsSection udid={U} platform={platform} deviceName="Galaxy S9+" />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
const rows = () => within(screen.getByRole('list', { name: 'Installed apps' })).getAllByRole('listitem');

beforeEach(() => {
  vi.clearAllMocks();
  copy.ok = true;
  api.listApps.mockResolvedValue(['com.zeta.app', 'com.alpha.app', 'io.appium.settings']);
  api.getApps.mockResolvedValue([
    { id: 'lib-a', name: 'Shop', platform: 'android', version: '2.1', packageName: 'com.shop' },
    { id: 'lib-i', name: 'Shop iOS', platform: 'ios', version: '2.1', packageName: 'com.shop' },
  ]);
  api.installRepositoryApp.mockResolvedValue({ success: true });
  api.uploadAndInstallApp.mockResolvedValue({ success: true });
  api.uninstallApp.mockResolvedValue({ success: true });
});

describe('installed apps', () => {
  it('lists them sorted, and search filters', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows()[0]).toHaveTextContent('com.alpha.app');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search installed apps' }), {
      target: { value: 'ZETA' },
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('com.zeta.app');
  });

  it('says when nothing matches, and offers a typed package id', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const search = screen.getByRole('searchbox', { name: 'Search installed apps' });
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No apps match “zzz”')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'com.android.chrome' } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Not in the list');
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall com.android.chrome' }));
    expect(screen.getByRole('dialog', { name: 'Uninstall app?' })).toHaveTextContent('com.android.chrome');
  });

  it('says why the list failed, and Retry reloads it', async () => {
    api.listApps.mockRejectedValueOnce(new Error('adb offline'));
    open();
    expect(await screen.findByText(/Couldn’t load the apps: adb offline/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('says when there are none', async () => {
    api.listApps.mockResolvedValue([]);
    open();
    expect(await screen.findByText('No apps installed')).toBeInTheDocument();
  });

  it('asks before uninstalling; Cancel does nothing, Uninstall does', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall com.alpha.app' }));
    let dialog = screen.getByRole('dialog', { name: 'Uninstall app?' });
    expect(dialog).toHaveTextContent('com.alpha.app');
    expect(dialog).toHaveTextContent('Galaxy S9+');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.uninstallApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall com.alpha.app' }));
    dialog = screen.getByRole('dialog', { name: 'Uninstall app?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(api.uninstallApp).toHaveBeenCalledWith(U, 'com.alpha.app'));
    await waitFor(() => expect(told('success')).toContain('Uninstalled com.alpha.app from Galaxy S9+'));
  });

  it('copies a package id, and selects it when the browser blocks copying', async () => {
    open();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Copy com.alpha.app' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    copy.ok = false;
    fireEvent.click(screen.getByRole('button', { name: 'Copy com.zeta.app' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('blocked copying'), 'info'),
    );
    expect(window.getSelection()?.toString()).toBe('com.zeta.app');
  });
});

describe('install from library', () => {
  it('lists only this platform’s builds, and installs the one chosen', async () => {
    open('android');
    fireEvent.click(screen.getByRole('button', { name: 'Install from library' }));
    const item = await screen.findByRole('menuitem', { name: /Shop/ });
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(item).toHaveTextContent('2.1 · com.shop');
    fireEvent.click(item);
    await waitFor(() => expect(api.installRepositoryApp).toHaveBeenCalledWith(U, 'lib-a'));
    expect(toast).toHaveBeenCalledWith('Installing Shop on Galaxy S9+…', 'loading', 0);
    await waitFor(() => expect(told('success')).toContain('Installed Shop on Galaxy S9+'));
  });

  it('says why a library install failed', async () => {
    api.installRepositoryApp.mockResolvedValue({ success: false, error: 'INSTALL_FAILED_OLDER_SDK' });
    open('android');
    fireEvent.click(screen.getByRole('button', { name: 'Install from library' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Shop/ }));
    await waitFor(() => expect(told('error')).toContain('Couldn’t install Shop: INSTALL_FAILED_OLDER_SDK'));
  });

  it('points to the Apps library when it has nothing for this platform', async () => {
    api.getApps.mockResolvedValue([{ id: 'lib-i', name: 'Shop iOS', platform: 'ios' }]);
    open('android');
    fireEvent.click(screen.getByRole('button', { name: 'Install from library' }));
    expect(await screen.findByText('No Android apps in the library yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open the Apps library' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps');
  });
});

describe('upload file', () => {
  it('accepts this platform’s files and installs the one chosen', async () => {
    open('ios');
    const input = screen.getByLabelText('App file to upload');
    expect(input).toHaveAttribute('accept', '.ipa,.app');
    fireEvent.change(input, { target: { files: [new File(['x'], 'Shop.ipa')] } });
    await waitFor(() => expect(api.uploadAndInstallApp).toHaveBeenCalledWith(U, expect.any(File)));
    await waitFor(() => expect(told('success')).toContain('Installed Shop.ipa on Galaxy S9+'));
  });
});
```

- [ ] **Step 2: Watch them fail.** Run `cd web && npx vitest run src/components/device-control/actions/AppsSection.test.tsx`. Expected: FAIL, no module.

- [ ] **Step 3: Implement** `AppsSection.tsx`:

```tsx
import * as React from 'react';
import { Check, Copy, Library, Loader2, Package, RefreshCw, Search, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import XenonApiService from '../../../api-service';
import { Button } from '../../ui/button';
import { Menu, MenuItem } from '../../ui/Menu';
import { Modal } from '../../ui/Modal';
import { Popover } from '../../ui/Popover';
import { useToast } from '../../ui/toast';
import { errorReason, failed } from '../actionMessages';
import {
  filterApps,
  libraryAppsFor,
  libraryNote,
  looksLikePackageId,
  platformNoun,
  uploadAccept,
  type LibraryApp,
} from './appsList';
import { COPY_BLOCKED, copyText } from './copyText';

interface Props {
  udid: string;
  platform: string;
  deviceName: string;
}

type Load = 'loading' | 'ready' | 'error';

/**
 * Install from the Apps library or a file, and the installed apps as a
 * searchable list. Package ids used to sit in a native dropdown you couldn't
 * search, and installs took only a file from your computer.
 */
export function AppsSection({ udid, platform, deviceName }: Props) {
  const { toast, removeToast } = useToast();
  const navigate = useNavigate();

  const [apps, setApps] = React.useState<string[]>([]);
  const [appsState, setAppsState] = React.useState<Load>('loading');
  const [appsError, setAppsError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [installing, setInstalling] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [library, setLibrary] = React.useState<LibraryApp[]>([]);
  const [libraryState, setLibraryState] = React.useState<Load>('loading');
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const libraryButton = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const loadApps = React.useCallback(async () => {
    setAppsState('loading');
    try {
      const list = await XenonApiService.listApps(udid);
      setApps(Array.isArray(list) ? list : []);
      setAppsState('ready');
    } catch (err) {
      setAppsError(errorReason(err));
      setAppsState('error');
    }
  }, [udid]);

  React.useEffect(() => {
    loadApps();
  }, [loadApps]);

  // The device takes a moment to report an install or uninstall.
  const reloadSoon = (ms: number) => setTimeout(loadApps, ms);

  React.useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(null), 1500);
    return () => clearTimeout(t);
  }, [copiedId]);

  const loadLibrary = async () => {
    setLibraryState('loading');
    try {
      const list = await XenonApiService.getApps();
      setLibrary(Array.isArray(list) ? list : []);
      setLibraryState('ready');
    } catch {
      setLibraryState('error');
    }
  };

  const openLibrary = () => {
    setMenuOpen(true);
    loadLibrary();
  };

  const closeMenu = () => {
    setMenuOpen(false);
    libraryButton.current?.focus();
  };

  // Focus the first choice once there is one, so the arrow keys work at once.
  React.useEffect(() => {
    if (!menuOpen || libraryState === 'loading') return;
    const item = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)');
    item?.focus();
  }, [menuOpen, libraryState]);

  const install = async (label: string, run: () => Promise<any>) => {
    setInstalling(true);
    const toastId = toast(`Installing ${label} on ${deviceName}…`, 'loading', 0);
    try {
      const result = await run();
      if (result?.success) {
        toast(`Installed ${label} on ${deviceName}`, 'success');
        reloadSoon(5000);
      } else {
        toast(failed(`install ${label}`, { message: result?.error }), 'error');
      }
    } catch (err) {
      toast(failed(`install ${label}`, err), 'error');
    } finally {
      removeToast(toastId);
      setInstalling(false);
    }
  };

  const installFromLibrary = (app: LibraryApp) => {
    setMenuOpen(false);
    install(app.name, () => XenonApiService.installRepositoryApp(udid, app.id));
  };

  const uploadChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) install(file.name, () => XenonApiService.uploadAndInstallApp(udid, file));
  };

  const uninstallConfirmed = async () => {
    const id = confirm;
    setConfirm(null);
    if (!id) return;
    const toastId = toast(`Uninstalling ${id} from ${deviceName}…`, 'loading', 0);
    try {
      await XenonApiService.uninstallApp(udid, id);
      toast(`Uninstalled ${id} from ${deviceName}`, 'success');
      reloadSoon(3000);
    } catch (err) {
      toast(failed(`uninstall ${id}`, err), 'error');
    } finally {
      removeToast(toastId);
    }
  };

  const copyId = async (id: string, target: HTMLElement) => {
    if (await copyText(id)) {
      setCopiedId(id);
      return;
    }
    const idText = target.closest('li')?.querySelector('.actions-app-id');
    if (idText) window.getSelection()?.selectAllChildren(idText);
    toast(COPY_BLOCKED, 'info');
  };

  const shown = filterApps(apps, query);
  const typed = query.trim();
  const offerTyped =
    appsState === 'ready' && shown.length === 0 && looksLikePackageId(typed) && !apps.includes(typed);
  const matches = libraryAppsFor(library, platform);

  const row = (id: string, note?: string) => (
    <li key={id} className="actions-app-row">
      <span className="actions-app-id">{id}</span>
      {note && <span className="actions-app-note">{note}</span>}
      <span className="actions-app-tools">
        <Button
          variant="ghost"
          size="icon"
          aria-label={copiedId === id ? 'Copied' : `Copy ${id}`}
          title={copiedId === id ? 'Copied' : 'Copy package ID'}
          onClick={(e) => copyId(id, e.currentTarget)}
        >
          {copiedId === id ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="actions-app-uninstall"
          aria-label={`Uninstall ${id}`}
          onClick={() => setConfirm(id)}
        >
          Uninstall
        </Button>
      </span>
    </li>
  );

  return (
    <section className="actions-section" aria-labelledby="actions-apps-title">
      <div className="actions-section-head">
        <h4 id="actions-apps-title" className="actions-section-title">
          <Package size={15} aria-hidden="true" /> Apps
        </h4>
        <div className="actions-section-tools">
          <Button
            ref={libraryButton}
            variant="tonal"
            size="sm"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={installing}
            onClick={openLibrary}
          >
            {installing ? (
              <Loader2 className="animate-spin" size={13} aria-hidden="true" />
            ) : (
              <Library size={13} aria-hidden="true" />
            )}
            Install from library
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={installing}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={13} aria-hidden="true" /> Upload file
          </Button>
          <input
            ref={fileInput}
            type="file"
            hidden
            aria-label="App file to upload"
            accept={uploadAccept(platform)}
            onChange={uploadChosen}
          />
        </div>
      </div>

      <Popover open={menuOpen} onClose={closeMenu} anchorRef={libraryButton} placement="bottom-end">
        <div ref={menuRef} className="actions-library-menu">
          <Menu>
            {libraryState === 'loading' && (
              <MenuItem disabled onClick={() => {}}>
                Loading…
              </MenuItem>
            )}
            {libraryState === 'error' && (
              <MenuItem onClick={loadLibrary}>Couldn’t load the library. Retry</MenuItem>
            )}
            {libraryState === 'ready' && matches.length === 0 && (
              <>
                <MenuItem disabled onClick={() => {}}>
                  No {platformNoun(platform)} apps in the library yet
                </MenuItem>
                <MenuItem onClick={() => navigate('/apps')}>Open the Apps library</MenuItem>
              </>
            )}
            {libraryState === 'ready' &&
              matches.map((app) => (
                <MenuItem
                  key={app.id}
                  note={libraryNote(app) || undefined}
                  onClick={() => installFromLibrary(app)}
                >
                  {app.name}
                </MenuItem>
              ))}
          </Menu>
        </div>
      </Popover>

      <div className="actions-apps-tools">
        <div className="actions-search">
          <Search size={13} className="actions-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="type-input-field compact"
            aria-label="Search installed apps"
            placeholder={`Search ${apps.length} installed apps`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh installed apps"
          title="Refresh"
          onClick={loadApps}
        >
          <RefreshCw size={13} aria-hidden="true" />
        </Button>
      </div>

      {appsState === 'loading' && apps.length === 0 && (
        <p className="actions-list-note">Loading apps…</p>
      )}
      {appsState === 'error' && (
        <div className="actions-list-note" role="alert">
          Couldn’t load the apps{appsError ? `: ${appsError}` : '.'}
          <Button variant="secondary" size="sm" onClick={loadApps}>
            Retry
          </Button>
        </div>
      )}
      {appsState === 'ready' && apps.length === 0 && (
        <p className="actions-list-note">No apps installed</p>
      )}
      {appsState === 'ready' && apps.length > 0 && shown.length === 0 && !offerTyped && (
        <p className="actions-list-note">No apps match “{typed}”</p>
      )}

      <ul className="actions-apps-list" aria-label="Installed apps">
        {shown.map((id) => row(id))}
        {offerTyped && row(typed, 'Not in the list')}
      </ul>

      <Modal
        open={confirm !== null}
        title="Uninstall app?"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={uninstallConfirmed}>
              Uninstall
            </Button>
          </>
        }
      >
        <p className="actions-confirm-text">
          Uninstall <code>{confirm}</code> from{' '}
          <span className="actions-confirm-device">{deviceName}</span>? The app and its data are
          removed from the device.
        </p>
      </Modal>
    </section>
  );
}
```

- [ ] **Step 4: Watch them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** the two files: `feat(device-control): Apps section — install from library or file, searchable installed apps`.

### Task 4: `ActionsPanel`, wired into device control

**Files:**
- Create: `…/actions/ActionsPanel.tsx`, `…/actions/ActionsPanel.test.tsx`; complete `…/actions/actions.css`
- Modify: `web/src/components/device-control/device-control.tsx`, `…/device-control.css`, `…/device-control.test.tsx`

- [ ] **Step 1: Write the failing panel test.**

```tsx
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ swipe: vi.fn(), listApps: vi.fn() }));
const toast = vi.hoisted(() => vi.fn(() => 't'));
vi.mock('../../../api-service', () => ({ default: api }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));

import { ActionsPanel } from './ActionsPanel';

const open = () =>
  render(
    <MemoryRouter>
      <ActionsPanel udid="U1" platform="android" deviceName="Galaxy S9+" screenWidth={1000} screenHeight={2000} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.listApps.mockResolvedValue([]);
  api.swipe.mockResolvedValue({});
});

describe('ActionsPanel', () => {
  it('shows the three sections in order', () => {
    open();
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent?.trim())).toEqual([
      'Apps',
      'Text and clipboard',
      'Swipe',
    ]);
  });

  it('swipes through the screen centre, and says why a swipe failed', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Swipe up' }));
    await waitFor(() => expect(api.swipe).toHaveBeenCalledWith('U1', 500, 1800, 500, 200));
    api.swipe.mockRejectedValue(new Error('stream stopped'));
    fireEvent.click(screen.getByRole('button', { name: 'Swipe left' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Couldn’t swipe left: stream stopped', 'error'),
    );
  });
});
```

- [ ] **Step 2: Watch it fail.** Run `cd web && npx vitest run src/components/device-control/actions/ActionsPanel.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**

`ActionsPanel.tsx`:

```tsx
import * as React from 'react';
import XenonApiService from '../../../api-service';
import { useToast } from '../../ui/toast';
import { failed } from '../actionMessages';
import { AppsSection } from './AppsSection';
import { SwipeRow } from './SwipeRow';
import { swipePath, type SwipeDirection } from './swipe';
import { TextClipboardSection } from './TextClipboardSection';
import './actions.css';

interface Props {
  udid: string;
  platform: string;
  /** The name its Devices card shows, for every message. */
  deviceName: string;
  /** Device pixels, portrait (width < height), as device control computes them. */
  screenWidth: number;
  screenHeight: number;
}

/** Device control's Actions tab: Apps, then Text and clipboard, then Swipe. */
export function ActionsPanel({ udid, platform, deviceName, screenWidth, screenHeight }: Props) {
  const { toast } = useToast();

  const swipe = async (direction: SwipeDirection) => {
    const p = swipePath(direction, screenWidth, screenHeight);
    try {
      await XenonApiService.swipe(udid, p.startX, p.startY, p.endX, p.endY);
    } catch (err) {
      toast(failed(`swipe ${direction}`, err), 'error');
    }
  };

  return (
    <div className="actions-panel">
      <AppsSection udid={udid} platform={platform} deviceName={deviceName} />
      <TextClipboardSection udid={udid} platform={platform} />
      <SwipeRow onSwipe={swipe} />
    </div>
  );
}
```

`actions.css`, complete. It uses tokens only, and no rule starts with a shared Button class:

```css
/* Device control's Actions tab. Sections share the old .action-card surface
   (the well tint and border) without its whole-card hover highlight. */
.actions-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.actions-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: rgb(var(--rgb-well) / calc(0.2 * var(--well-k)));
}
.actions-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.actions-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text);
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
}
.actions-section-title svg {
  color: var(--color-accent);
}
.actions-section-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.actions-apps-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.actions-search {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}
.actions-search .type-input-field {
  padding-left: 28px;
}
.actions-search-icon {
  position: absolute;
  left: 9px;
  color: var(--text-dim);
  pointer-events: none;
}
.actions-apps-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: calc(6 * 36px);
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.actions-apps-list:empty {
  display: none;
}
.actions-app-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 4px 0 10px;
  border-bottom: 1px solid var(--border);
}
.actions-app-row:last-child {
  border-bottom: none;
}
.actions-app-row:hover {
  background: rgb(var(--rgb-fg) / 0.03);
}
.actions-app-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
}
.actions-app-note {
  color: var(--text-muted);
  font-size: 11px;
}
.actions-app-tools {
  display: flex;
  align-items: center;
  gap: 2px;
}
.actions-app-uninstall {
  color: var(--status-error-fg);
}
.actions-list-note {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}
.actions-library-menu {
  min-width: 240px;
  max-height: 320px;
  overflow-y: auto;
}

.actions-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.actions-field-label {
  flex: 0 0 76px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
}
.actions-field-row .type-input-field {
  flex: 1;
  min-width: 0;
}
.actions-status {
  min-height: 16px;
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.actions-swipe {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.actions-swipe-buttons {
  display: flex;
  gap: 6px;
}

.actions-confirm-text {
  margin: 0;
  line-height: 1.6;
}
.actions-confirm-text code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  word-break: break-all;
}
.actions-confirm-device {
  white-space: nowrap;
}
```

In `device-control.tsx`:
- Replace the whole `{activeTab === 'actions' && ( … )}` block with:
  ```tsx
  {activeTab === 'actions' && (
    <ActionsPanel
      udid={currentDevice.udid}
      platform={currentDevice.platform}
      deviceName={deviceName}
      screenWidth={deviceWidth}
      screenHeight={deviceHeight}
    />
  )}
  ```
- Import `ActionsPanel` from `./actions/ActionsPanel`.
- Delete what the Actions tab alone used:
  - state: `textInput`, `sending`, `justSent`, `confirmUninstall`, `clipboardContent`, `uninstallBundleId`, `installedApps`, `fetchingApps`, `installing`, `uploadFile`;
  - `loadInstalledApps` and its effect;
  - `sendText` and the `justSent` effect;
  - `fetchClipboard`, `quickSwipe`, `requestUninstall`, `uninstallConfirmed` and `handleInstall`;
  - the uninstall `<Modal>`.
- Then remove every import that `tsc`/eslint reports as unused (icons, `Modal`, `Button`, `clipboardError`, `failed`, and `Loader2` only if nothing else uses it).

In `device-control.css`, delete each rule whose class no `.tsx` references any more. Check each with `grep -rn "<class>" src --include=*.tsx`. The candidates are:
- `.app-mgmt-content`, `.install-section`, `.uninstall-section`, `.upload-box-row`, `.uninstall-controls-row`, `.manual-input-box`, `.file-upload-launcher` (and `:hover`, `:focus-within`);
- `.gestures-grid-container`, `.gestures-dpad`, `.dpad-btn`, `.dpad-center`, `.dpad-caption`;
- `.clipboard-row`, `.clipboard-display` (and `.compact`, and its light override);
- `.smart-input-row`, `.send-status`, `.uninstall-confirm-*`;
- `.actions-grid`, `.action-card` (and `.full-width`, `-title`, `-hint`, `:hover`).

Keep any that the Screenshot tab still uses (`.action-card.screenshot-card` and `.action-card-header` do). Keep `.select-wrapper`/`.select-loader` only if still referenced.

In `device-control.test.tsx`, delete the `describe('Actions tab', …)` block (its cases now live in the component tests) and the mocks only it used (`uninstallApp`, `typeText`, `getClipboard`, `swipe`). Keep the header tests.

- [ ] **Step 4: Run everything.** `cd web && npx vitest run && npx tsc --noEmit -p .`. Expected: all pass, including `button-classes` and `color-literals`.
- [ ] **Step 5: Lint against main.** `device-control.tsx` must be at 21 or fewer. The new files must be clean.
- [ ] **Step 6: Commit:** `feat(device-control): Actions tab is ActionsPanel — Apps, Text and clipboard, Swipe`.

### Task 5: Verify and open the PR

- [ ] **Step 1:** `npm run build:xenon && npm run build:copy`. Then run the threshold-0 harness: `cd web && npx playwright test --config <scratchpad>/dcshots/dc.config.mjs`. Expected: all 26 Screenshot and Logs captures match the main baseline.
- [ ] **Step 2:** `cd web && npx playwright test -g devices`. Expected: 14 pass, and the device-control route has no overflow.
- [ ] **Step 3:** Live on the S9+, in both themes:
  - Search the list, copy an ID, then open Uninstall and **cancel**.
  - Type `com.android.chrome` and see the "Not in the list" row; cancel its confirmation.
  - Library install: pull the calculator's APK (`adb shell pm path com.sec.android.app.popupcalculator` then `adb pull`), upload it to the Apps library, install it from the menu, check the toasts, then delete it from the library.
  - Read, Write and Copy the clipboard.
  - Send text into the Google search field, then press Home.
  - Swipe up and down.
  - Measure the contrast of every new element with computed styles.
- [ ] **Step 4:** Push, and open the PR with the evidence.
