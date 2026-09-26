# Interact / Annotate switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Live Devices' Annotate toggle with an Interact | Annotate switch that starts on Interact, with Esc back to Interact.

**Architecture:** The shared `ui/SegmentedControl` gains per-segment `disabled`, `title` and `keyShortcuts`. `RecordingControls` renders it in place of the Annotate button, and registers an Esc `keydown` listener only while annotating. `START_RECORDING` stops switching Annotate on. The tile's chip text changes. Everything else (drawing tools, storage, rendering) is untouched.

**Tech Stack:** React 17, TypeScript, Vitest + Testing Library, lucide-react.

Spec: `docs/superpowers/specs/2026-09-26-interact-annotate-switch-design.md`.

## Global Constraints

- The switch is always rendered; nothing appears or disappears when recording starts.
- Annotate is disabled unless a recording is running, with the tooltip "Start recording to annotate".
- Esc acts only while annotating, never from `input` / `textarea` / `select` / contenteditable, and never on key repeat.
- Tokens only in CSS (the colour-literal ratchet must pass). No new lint problems in touched files.
- Explicit `git add` paths. Branch: `feat/interact-annotate-switch` (it already holds the spec commit).

---

### Task 1: SegmentedControl — disabled, title and shortcut per segment

**Files:**
- Modify: `web/src/components/ui/SegmentedControl.tsx`
- Modify: `web/src/components/ui/segmented-control.css`
- Test: `web/src/components/ui/segmented-control.test.tsx`

**Interfaces:**
- Produces: `Segment<T>` gains `disabled?: boolean`, `title?: string` and `keyShortcuts?: string`.
  - A segment with a string `label` and a `title` keeps the label as its accessible name (`aria-label`); the title is only a tooltip.

- [ ] **Step 1: Write the failing tests** (append inside the `describe`):

```tsx
  it('disables a segment, explains why, and ignores clicks on it', () => {
    const fn = vi.fn();
    render(
      <SegmentedControl
        segments={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true, title: 'Not yet' },
        ]}
        value="a"
        onChange={fn}
      />,
    );
    const b = screen.getByRole('tab', { name: 'B' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Not yet');
    fireEvent.click(b);
    expect(fn).not.toHaveBeenCalled();
  });

  it('declares a keyboard shortcut on a segment', () => {
    render(
      <SegmentedControl
        segments={[{ value: 'a', label: 'A', keyShortcuts: 'Escape' }]}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-keyshortcuts', 'Escape');
  });
```

- [ ] **Step 2: Run them:** `cd web && npx vitest run src/components/ui/segmented-control.test.tsx`. Expected: 2 FAIL.

- [ ] **Step 3: Implement.** In `SegmentedControl.tsx`, extend `Segment`:

```tsx
  /** Unavailable for now; `title` should say why. */
  disabled?: boolean;
  /** Tooltip. A string label stays the accessible name. */
  title?: string;
  /** Announced shortcut, e.g. "Escape" (aria-keyshortcuts). */
  keyShortcuts?: string;
```

and render each button as:

```tsx
        <button
          key={s.value}
          role="tab"
          aria-selected={s.value === value}
          aria-label={s.title && typeof s.label === 'string' ? s.label : undefined}
          aria-keyshortcuts={s.keyShortcuts}
          title={s.title}
          disabled={s.disabled}
          className={`seg-btn${s.value === value ? ' seg-btn-active' : ''}`}
          onClick={() => {
            if (!s.disabled) onChange(s.value);
          }}
          type="button"
        >
```

In `segmented-control.css`, after `.seg-btn:hover`:

```css
.seg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.seg-btn:disabled:hover { color: var(--text-muted); }
```

- [ ] **Step 4: Run them:** Expected: PASS (the whole file).
- [ ] **Step 5: Commit:** `git add web/src/components/ui/SegmentedControl.tsx web/src/components/ui/segmented-control.css web/src/components/ui/segmented-control.test.tsx && git commit -m "feat(ui): segmented control segments can be disabled, titled and have a shortcut"`

### Task 2: Recording starts on Interact

**Files:**
- Modify: `web/src/components/mosaic/recording-group-store.ts` (`START_RECORDING`, the `annotateMode: true` line)
- Test: `web/src/components/mosaic/recording-group-store.test.ts` (the `START_RECORDING sets the group flag…` test)

- [ ] **Step 1: Change the test's expectation.** In `START_RECORDING sets the group flag and per-tile recordingIds`, replace `expect(s.annotateMode).to.equal(true);` with:

```ts
    // Recording starts on Interact: most people record to capture themselves
    // using the phone, and Annotate blocked every tap until turned off.
    expect(s.annotateMode).to.equal(false);
```

- [ ] **Step 2: Run it:** `npx vitest run src/components/mosaic/recording-group-store.test.ts`. Expected: FAIL (`true` ≠ `false`).
- [ ] **Step 3: Implement.** In `START_RECORDING`, replace the two comment lines and `annotateMode: true,` with:

```ts
        // Start on Interact: taps reach the phone. Annotate is one click away.
        annotateMode: false,
```

- [ ] **Step 4: Run it:** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "fix(mosaic): a recording starts on Interact, not Annotate"` (explicit paths).

### Task 3: The switch and Esc in RecordingControls

**Files:**
- Modify: `web/src/components/mosaic/RecordingControls.tsx`
- Test: `web/src/components/mosaic/RecordingControls.test.tsx`

**Interfaces:**
- Consumes: `Segment.disabled`, `title` and `keyShortcuts` (Task 1); the `SET_ANNOTATE_MODE` action.

- [ ] **Step 1: Write the failing tests.** In `RecordingControls labels`, change `labels its buttons in words` to expect `['Record', 'Stop']`. The switch's sides are tabs, not buttons. Then add a new `describe`:

```tsx
describe('Interact / Annotate switch', () => {
  const tab = (name: string) => screen.getByRole('tab', { name }) as HTMLButtonElement;

  it('shows Interact selected and Annotate unavailable before recording', () => {
    mount(idleWithTile());
    expect(tab('Interact')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Annotate')).toBeDisabled();
    expect(tab('Annotate')).toHaveAttribute('title', 'Start recording to annotate');
  });

  it('starts a recording on Interact, with the drawing tools off', () => {
    const s = mosaicReducer(idleWithTile(), {
      type: 'START_RECORDING',
      groupId: 'g',
      startedAt: Date.now(),
      tileIds: { u1: 'r1' },
    });
    mount(s);
    expect(tab('Interact')).toHaveAttribute('aria-selected', 'true');
    expect((screen.getByRole('button', { name: 'Rect' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('switches to Annotate on click', () => {
    const dispatch = vi.fn();
    mount(recording(false, false), dispatch);
    fireEvent.click(tab('Annotate'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ANNOTATE_MODE', enabled: true });
  });

  it('declares Esc as the way back to Interact', () => {
    mount(recording(true, false));
    expect(tab('Interact')).toHaveAttribute('aria-keyshortcuts', 'Escape');
  });

  it('returns to Interact on Esc while annotating', () => {
    const dispatch = vi.fn();
    mount(recording(true, false), dispatch);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ANNOTATE_MODE', enabled: false });
  });

  it('ignores Esc typed into a text field', () => {
    const dispatch = vi.fn();
    mount(recording(true, false), dispatch);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    input.remove();
    expect(dispatch).not.toHaveBeenCalled();
  });

  // In Interact mode a focused Android tile sends Esc to the phone as Back.
  it('leaves Esc alone when not annotating', () => {
    const dispatch = vi.fn();
    mount(recording(false, false), dispatch);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them:** `npx vitest run src/components/mosaic/RecordingControls.test.tsx`. Expected: the new tests FAIL (no tabs), and `labels its buttons in words` FAILs (`Annotate` is still a button).

- [ ] **Step 3: Implement.** In `RecordingControls.tsx`:
   - Import `MousePointer2` from lucide-react (and keep `Pencil`), and `SegmentedControl` from `../ui/SegmentedControl`.
   - Replace `toggleAnnotate` with:

```tsx
  const setMode = (mode: 'interact' | 'annotate') => {
    const enabled = mode === 'annotate';
    if (enabled && !canAnnotate) return;
    if (enabled !== state.annotateMode) dispatch({ type: 'SET_ANNOTATE_MODE', enabled });
  };

  // Esc returns to Interact, only while annotating: in Interact mode a
  // focused Android tile sends Esc to the phone as Back.
  React.useEffect(() => {
    if (!state.annotateMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return;
      dispatch({ type: 'SET_ANNOTATE_MODE', enabled: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.annotateMode, dispatch]);
```

   - Replace the whole Annotate `<button>…</button>` with:

```tsx
      {/* Always rendered: controls that appear in this row slide others under
          the cursor. Annotate only works inside a recording. */}
      <SegmentedControl<'interact' | 'annotate'>
        size="sm"
        value={state.annotateMode ? 'annotate' : 'interact'}
        onChange={setMode}
        segments={[
          {
            value: 'interact',
            label: 'Interact',
            title: 'Tap, swipe and type on the devices (Esc)',
            keyShortcuts: 'Escape',
          },
          {
            value: 'annotate',
            label: 'Annotate',
            title: canAnnotate ? 'Draw marks on the recording' : 'Start recording to annotate',
            disabled: !canAnnotate,
          },
        ]}
      />
```

   - Update `clearAnnotations` (it referenced `canAnnotate` only; unchanged).

- [ ] **Step 4: Run them:** Expected: PASS (the whole file, including the existing "same buttons whether or not annotate" test, which counts buttons only).
- [ ] **Step 5: Commit:** `git commit -m "feat(mosaic): Interact / Annotate switch, Esc back to Interact"` (explicit paths).

### Task 4: The tile chip

**Files:**
- Modify: `web/src/components/mosaic/DeviceTile.tsx` (the "Annotating · drag to mark" chip)
- Test: `web/src/components/mosaic/DeviceTile.test.tsx`

- [ ] **Step 1: Write the failing test** (in `describe('DeviceTile')`):

```tsx
  it('tells an annotating user how to stop', () => {
    const { container } = tile({ recordingId: 'r1', annotateMode: true });
    goLive(container);
    expect(screen.getByText('Annotating · Esc to stop')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it:** `npx vitest run src/components/mosaic/DeviceTile.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement:** change the chip text to `Annotating · Esc to stop`.
- [ ] **Step 4: Run it:** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "fix(mosaic): the annotate chip says how to stop"` (explicit paths).

### Task 5: Verify and open the PR

- [ ] **Step 1: Run the checks:**

```bash
cd web && npx vitest run 2>&1 | tail -3 && npx tsc --noEmit -p .
```

Expected: all green. Also run a per-file lint comparison against `origin/main`.

- [ ] **Step 2: Build:** `npm run build:xenon && npm run build:copy` (repo root).

- [ ] **Step 3: Live check on the S9+** (Browser pane, `/xenon/devices/live`):
  1. Add the S9+ and press Record. The switch shows Interact.
  2. Tap the tile; the server log shows `POST /xenon/api/control/381103b720057ece/tap`.
  3. Click Annotate and drag a rectangle; the log shows `POST /xenon/api/recordings/<group>/annotation` → 201.
  4. Press Esc; the switch shows Interact, and the next tap reaches the phone again.
  5. Stop, then remove the tile.

- [ ] **Step 4: Screenshots** of the toolbar in dark and light: idle, recording on Interact, and recording on Annotate.

- [ ] **Step 5: Push and open the PR** with the evidence.
