# Modal Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire five hand-rolled dialog implementations by migrating them onto the Radix-backed `ui/Modal` primitive, and give the primitive a medium-polish visual refresh in the same change.

**Architecture:** One primitive touches all call sites. Extend `web/src/components/ui/Modal.tsx` (+ `modal.css`) with a `closeOnOverlayClick` prop and an always-rendered close-X button; refresh the chrome (backdrop blur, softer shadow, 12px radius, fade+scale motion). Then rewrite five call sites to use `<Modal>` and delete the local `Modal` components in `api-keys.tsx` and `teams.tsx`. CSS for per-modal chrome (overlays, card shells, scanlines, header chrome) is deleted; form-body CSS survives.

**Tech Stack:** React 17 · TypeScript 5 · Vite 5 + Vitest (jsdom) · `@radix-ui/react-dialog` 1.1 · `lucide-react` for the close-X icon.

**Branch:** `refactor/web-adopt-modal-primitive` (already checked out from main with the spec committed as `d2003e5`).

**Spec:** `docs/superpowers/specs/2026-04-24-modal-adoption-design.md`.

---

## File Structure

| File | Responsibility in this PR |
|---|---|
| `web/src/components/ui/Modal.tsx` | Rewrite internals: add `closeOnOverlayClick` prop, render close-X button in header flex row, keep existing focus-restore workaround. |
| `web/src/components/ui/modal.css` | Rewrite: polish overlay (blur), card (12px radius, soft shadow), header (flex row with title + close), body (20px padding), footer, keyframes for fade+scale. |
| `web/src/components/ui/modal.test.tsx` | Add 3 tests for the new behavior. |
| `web/src/components/reservation-modal/reservation-modal.tsx` | Replace hand-rolled overlay/card with `<Modal>`; keep form-body content. |
| `web/src/components/reservation-modal/reservation-modal.css` | Delete overlay/card/header/close-btn/actions/keyframes rules; keep form-body rules (drop `.reservation-modal-body` padding). |
| `web/src/components/tag-manager-modal/tag-manager-modal.tsx` | Replace hand-rolled overlay/card with `<Modal>`; drop inline ESC branch; keep `inputRef` autofocus. |
| `web/src/components/tag-manager-modal/tag-manager-modal.css` | Delete overlay/card/header/close-btn/footer/keyframes rules; keep form-body rules (drop `.tag-modal-body` padding). |
| `web/src/components/settings/api-keys.tsx` | Replace two local-Modal usages (Create + Reveal) with `<Modal>`; Reveal passes `closeOnOverlayClick={false}`; delete local `Modal` component. |
| `web/src/components/settings/teams.tsx` | Replace one local-Modal usage with `<Modal>`; delete local `Modal` component. |

No file splits or renames. No new files created.

---

## Task 1: Primitive polish (TDD) — new prop, close-X button, visual refresh

**Files:**
- Modify: `web/src/components/ui/Modal.tsx`
- Modify: `web/src/components/ui/modal.css`
- Modify: `web/src/components/ui/modal.test.tsx`

- [ ] **Step 1: Add the three new failing tests**

Append inside the existing `describe('Modal', ...)` block in `web/src/components/ui/modal.test.tsx` (after the last existing test, before the closing `});`):

```tsx
  it('closes when the header close button is clicked', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await act(async () => {
      await Promise.resolve();
    });
    const closeBtn = document.querySelector('.modal-close') as HTMLElement;
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on overlay pointerdown when closeOnOverlayClick is false', async () => {
    const onClose = vi.fn();
    render(
      <Modal
        open={true}
        title="t"
        onClose={onClose}
        closeOnOverlayClick={false}
      >
        <button>inside</button>
      </Modal>,
    );
    const overlay = document.querySelector('.modal-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    // DismissableLayer registers its pointerdown listener inside setTimeout(0).
    // Flush that macrotask before firing so the listener is active.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.pointerDown(overlay);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.modal')).not.toBeNull();
  });

  it('still closes on Escape when closeOnOverlayClick is false', () => {
    const onClose = vi.fn();
    render(
      <Modal
        open={true}
        title="t"
        onClose={onClose}
        closeOnOverlayClick={false}
      >
        <button>inside</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify the three new ones fail**

Run: `cd web && npx vitest run src/components/ui/modal.test.tsx`

Expected: exactly the three new tests fail. The first fails because `.modal-close` does not exist yet. The second fails because the `closeOnOverlayClick` prop is not wired (overlay click still closes). The third fails to compile until `closeOnOverlayClick` is a known prop — acceptable TS compile error is also a valid "failure" for TDD; if the test runner short-circuits on compile error, that counts as the failing signal for all three.

- [ ] **Step 3: Rewrite `Modal.tsx` to satisfy the new tests**

Replace the entire contents of `web/src/components/ui/Modal.tsx` with:

```tsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import './modal.css';

export interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  closeOnOverlayClick?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  onClose,
  footer,
  children,
  width = 480,
  closeOnOverlayClick = true,
}) => {
  // Capture the focused element before the dialog opens so we can restore it
  // on close. Radix FocusScope calls focus(previouslyFocusedElement) inside a
  // setTimeout(0) on unmount, but in JSDOM the element it captures at mount
  // time is already wrong: fireEvent.click() does not keep the clicked element
  // as activeElement across the synchronous React re-render that opens the
  // dialog, so FocusScope records the wrong element. We save it one render
  // earlier (while open is still false) and restore it ourselves via
  // onCloseAutoFocus, which lets us preventDefault() on Radix's built-in
  // restoration attempt and supply the correct target instead.
  // This workaround can be removed once: (a) all modal tests use
  // @testing-library/user-event (which correctly tracks activeElement), or
  // (b) JSDOM updates activeElement synchronously on fireEvent.click.
  const returnFocusRef = React.useRef<Element | null>(null);

  React.useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement;
    }
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content
          className="modal"
          style={{ width }}
          aria-describedby={undefined}
          onPointerDownOutside={(e) => {
            if (!closeOnOverlayClick) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const el = returnFocusRef.current;
            if (el && 'focus' in el) {
              (el as HTMLElement).focus();
            }
          }}
        >
          <div className="modal-header">
            <DialogPrimitive.Title asChild>
              <div className="modal-title">{title}</div>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button type="button" className="modal-close" aria-label="Close">
                <X size={18} />
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
```

- [ ] **Step 4: Rewrite `modal.css` for the polished chrome**

Replace the entire contents of `web/src/components/ui/modal.css` with:

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  z-index: 8000;
  animation: modal-overlay-in 150ms ease-out;
}
.modal-overlay[data-state='closed'] {
  animation: modal-overlay-out 150ms ease-in;
}

.modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 8001;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  font-family: 'Inter', sans-serif;
  animation: modal-card-in 150ms ease-out;
}
.modal[data-state='closed'] {
  animation: modal-card-out 150ms ease-in;
}

@keyframes modal-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes modal-overlay-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes modal-card-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.97); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes modal-card-out {
  from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  to { opacity: 0; transform: translate(-50%, -50%) scale(0.97); }
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.modal-title {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.modal-close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease, color 120ms ease;
}
.modal-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
}
.modal-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.modal-body {
  padding: 20px;
  color: var(--text-secondary);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.modal-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--border-default);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 5: Run the full modal test file to verify all 10 tests pass**

Run: `cd web && npx vitest run src/components/ui/modal.test.tsx`

Expected: 10 passing (7 existing + 3 new).

- [ ] **Step 6: Run the full web test suite to confirm no collateral breakage**

Run: `cd web && npx vitest run`

Expected: all existing tests still pass. (The Popover and Menu tests depend on `popover.css` for the shared `.popover` styling; this change does not touch that file.)

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ui/Modal.tsx web/src/components/ui/modal.css web/src/components/ui/modal.test.tsx
git commit -m "refactor(web): polish ui/Modal primitive with close button and closeOnOverlayClick"
```

---

## Task 2: Adopt `ui/Modal` in `reservation-modal.tsx`

**Files:**
- Modify: `web/src/components/reservation-modal/reservation-modal.tsx`
- Modify: `web/src/components/reservation-modal/reservation-modal.css`

- [ ] **Step 1: Rewrite `reservation-modal.tsx` to use the primitive**

Replace the entire contents of `web/src/components/reservation-modal/reservation-modal.tsx` with:

```tsx
import React, { useState } from 'react';
import './reservation-modal.css';
import { Clock, User, MessageSquare, AlertCircle, CalendarPlus } from 'lucide-react';
import XenonApiService from '../../api-service';
import { IDevice } from '../../interfaces/IDevice';
import { Modal } from '../ui/Modal';

interface ReservationModalProps {
  device: IDevice;
  onClose: () => void;
  onReserved: () => void;
}

const DURATION_OPTIONS = [
  { label: '1 Hour', value: '1h' },
  { label: '2 Hours', value: '2h' },
  { label: '4 Hours', value: '4h' },
  { label: '8 Hours', value: '8h' },
];

const ReservationModal: React.FC<ReservationModalProps> = ({ device, onClose, onReserved }) => {
  const [reservedBy, setReservedBy] = useState('');
  const [duration, setDuration] = useState('1h');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReserve = async () => {
    if (!reservedBy.trim()) {
      setError('Please enter your name/ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await XenonApiService.reserveDevice(
        device.udid,
        device.host,
        reservedBy,
        duration,
        reason,
      );

      if (response.success) {
        onReserved();
        onClose();
      } else {
        setError(response.error || 'Failed to reserve device');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      width={520}
      title={
        <>
          <CalendarPlus size={16} className="title-icon" />
          Reserve Device
        </>
      }
      footer={
        <>
          <button className="btn-cancel" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn-reserve"
            onClick={handleReserve}
            disabled={loading || !reservedBy.trim()}
          >
            {loading ? 'Reserving...' : 'Confirm Reservation'}
          </button>
        </>
      }
    >
      <div className="reservation-modal-body">
        <div className="device-id-badge">
          <span className="label">Device:</span>
          <span className="value">{device.udid}</span>
        </div>

        <p>
          Reserve <strong>{device.name || device.udid}</strong> for exclusive use. This will
          prevent CI sessions from using this device.
        </p>

        <div className="reservation-form-group">
          <label>
            <User
              size={14}
              style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
            />
            Reserved By
          </label>
          <input
            type="text"
            className="reservation-input"
            placeholder="Enter your name or ID"
            value={reservedBy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReservedBy(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="reservation-form-group">
          <label>
            <Clock
              size={14}
              style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
            />
            Duration
          </label>
          <div className="duration-selector">
            {DURATION_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                className={`duration-option ${duration === opt.value ? 'active' : ''}`}
                onClick={() => setDuration(opt.value)}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </div>

        <div className="reservation-form-group">
          <label>
            <MessageSquare
              size={14}
              style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
            />
            Reason (Optional)
          </label>
          <input
            type="text"
            className="reservation-input"
            placeholder="e.g., Debugging flaky login test"
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
            disabled={loading}
          />
        </div>

        {error && (
          <div className="error-message">
            <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ReservationModal;
```

Key changes:
- Removed `createPortal` import + call (primitive portals internally).
- Removed `X`, `Tag` imports (no longer needed).
- Replaced the outer overlay/card/header/actions DOM with `<Modal>`, `title`, and `footer` props.
- Deleted the scanline decoration div.
- Kept the `.reservation-modal-body` wrapper around content for the existing flex/gap layout.

- [ ] **Step 2: Trim `reservation-modal.css` to just the form-body rules**

Replace the entire contents of `web/src/components/reservation-modal/reservation-modal.css` with:

```css
.title-icon {
    color: var(--accent);
}

.reservation-modal-body {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.reservation-modal-body p {
    color: var(--text-subtle);
    font-size: 13px;
    line-height: 1.6;
    margin: 0;
}

.device-id-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(0, 0, 0, 0.4);
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--border-default);
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    width: fit-content;
    margin-bottom: 12px;
}

.device-id-badge .label {
    color: var(--text-subtle);
    text-transform: uppercase;
    font-weight: 800;
    font-size: 10px;
}

.device-id-badge .value {
    color: var(--accent);
    font-weight: 800;
}

.reservation-form-group {
    margin-bottom: 0;
}

.reservation-form-group label {
    display: block;
    color: var(--text-subtle);
    font-size: 11px;
    font-weight: 800;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: 'JetBrains Mono', monospace;
}

.reservation-input {
    width: 100%;
    background-color: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 12px 16px;
    color: var(--text-primary);
    font-size: 13px;
    box-sizing: border-box;
    transition: all 0.2s;
    font-family: 'JetBrains Mono', monospace;
}

.reservation-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 10px rgba(0, 255, 136, 0.1);
}

.duration-selector {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 8px;
}

.duration-option {
    background-color: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-default);
    color: var(--text-subtle);
    padding: 10px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    text-align: center;
    transition: all 0.2s;
    font-weight: 800;
    font-family: 'JetBrains Mono', monospace;
}

.duration-option:hover {
    border-color: var(--text-muted);
    background-color: rgba(255, 255, 255, 0.02);
}

.duration-option.active {
    background-color: rgba(0, 255, 136, 0.05);
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 10px rgba(0, 255, 136, 0.1);
}

.btn-cancel {
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-subtle);
    padding: 10px 24px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
    font-family: 'JetBrains Mono', monospace;
}

.btn-cancel:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
}

.btn-reserve {
    background: var(--accent);
    color: var(--bg-canvas);
    border: none;
    padding: 10px 24px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
    font-family: 'JetBrains Mono', monospace;
    box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
}

.btn-reserve:hover:not(:disabled) {
    background: #00e67a;
    box-shadow: 0 0 25px rgba(0, 255, 136, 0.4);
}

.btn-reserve:disabled {
    background-color: var(--border-default);
    color: var(--text-subtle);
    cursor: not-allowed;
    box-shadow: none;
    filter: grayscale(1);
    opacity: 0.5;
}

.error-message {
    color: #ff4d4d;
    font-size: 11px;
    margin-top: 12px;
    background-color: rgba(255, 77, 77, 0.05);
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 77, 77, 0.2);
    font-family: 'JetBrains Mono', monospace;
}
```

Rules deleted vs original file: `.reservation-modal-overlay`, `.reservation-modal`, `@keyframes modal-enter`, `.reservation-modal-header`, `.reservation-modal-title`, `.close-btn`, `.close-btn:hover`, `.reservation-actions`. The `.reservation-modal-body` rule loses its `padding: 24px` (primitive's `.modal-body` handles padding now). `.reservation-modal p` is renamed to `.reservation-modal-body p` since the outer `.reservation-modal` container no longer exists.

- [ ] **Step 3: Verify type-check and build**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Verify the test suite still passes**

Run: `cd web && npx vitest run`

Expected: all tests pass (no tests directly target reservation-modal; this confirms the rest of the suite is unaffected).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/reservation-modal/reservation-modal.tsx web/src/components/reservation-modal/reservation-modal.css
git commit -m "refactor(web): adopt ui/Modal in reservation-modal"
```

---

## Task 3: Adopt `ui/Modal` in `tag-manager-modal.tsx`

**Files:**
- Modify: `web/src/components/tag-manager-modal/tag-manager-modal.tsx`
- Modify: `web/src/components/tag-manager-modal/tag-manager-modal.css`

- [ ] **Step 1: Rewrite `tag-manager-modal.tsx` to use the primitive**

Replace the entire contents of `web/src/components/tag-manager-modal/tag-manager-modal.tsx` with:

```tsx
import React, { useState, useEffect, useRef } from 'react';
import './tag-manager-modal.css';
import { Tag as TagIcon, X, Plus } from 'lucide-react';
import { IDevice } from '../../interfaces/IDevice';
import XenonApiService from '../../api-service';
import { useToast } from '../ui/toast';
import { Modal } from '../ui/Modal';

interface TagManagerModalProps {
  device: IDevice;
  onClose: () => void;
  onUpdated: () => void;
}

const TagManagerModal: React.FC<TagManagerModalProps> = ({ device, onClose, onUpdated }) => {
  const { toast } = useToast();
  const [tags, setTags] = useState<string[]>(device.tags || []);
  const [inputValue, setInputValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleAddTag = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setInputValue('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await XenonApiService.updateDeviceTags(device.udid, device.host, tags);
      onUpdated();
      onClose();
    } catch (err) {
      console.error('Failed to update tags', err);
      toast('Error saving tags. Please try again.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      width={520}
      title={
        <>
          <TagIcon size={16} className="title-icon" />
          Manage Device Tags
        </>
      }
      footer={
        <>
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-save" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Apply Changes'}
          </button>
        </>
      }
    >
      <div className="tag-modal-body">
        <div className="device-id-badge">
          <span className="label">Device:</span>
          <span className="value">{device.udid}</span>
        </div>

        <div className="tag-input-section">
          <label htmlFor="tag-input">Add New Tag</label>
          <div className="input-with-button">
            <input
              ref={inputRef}
              id="tag-input"
              type="text"
              placeholder="e.g. stable, team-a, ios-17"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="add-inline-btn"
              onClick={handleAddTag}
              disabled={!inputValue.trim()}
            >
              <Plus size={16} />
            </button>
          </div>
          <p className="input-hint">Press Enter to add multiple tags</p>
        </div>

        <div className="tags-display-section">
          <label>Current Tags</label>
          <div className="tags-list">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <div key={tag} className="tag-pill-editable">
                  {tag}
                  <button className="remove-tag" onClick={() => handleRemoveTag(tag)}>
                    <X size={12} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-tags">No tags assigned to this device.</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default TagManagerModal;
```

Key changes:
- Replaced outer overlay/container/header/footer DOM with `<Modal>`, `title`, `footer` props.
- Deleted the scanline decoration div.
- Removed the `Escape` branch from `handleKeyDown` (primitive handles ESC).
- Kept the `inputRef` autofocus — Radix FocusScope honors it as the first focusable element and field-first focus is the desired behavior.
- `X` is still imported because it's used inside tag pills for the remove icon.

- [ ] **Step 2: Trim `tag-manager-modal.css` to just the form-body rules**

Replace the entire contents of `web/src/components/tag-manager-modal/tag-manager-modal.css` with:

```css
.title-icon {
    color: var(--accent);
}

.tag-modal-body {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.device-id-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(0, 0, 0, 0.4);
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--border-default);
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
}

.device-id-badge .label {
    color: var(--text-subtle);
    text-transform: uppercase;
    font-weight: 800;
    font-size: 10px;
}

.device-id-badge .value {
    color: var(--accent);
    font-weight: 800;
}

.tag-input-section label,
.tags-display-section label {
    display: block;
    font-size: 11px;
    font-weight: 800;
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
    font-family: 'JetBrains Mono', monospace;
}

.tag-input-section .input-with-button {
    display: flex;
    gap: 8px;
}

.tag-input-section input {
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 10px 14px;
    color: var(--text-primary);
    font-size: 13px;
    transition: all 0.2s;
    font-family: 'JetBrains Mono', monospace;
}

.tag-input-section input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
}

.tag-input-section .input-hint {
    margin: 6px 0 0 0;
    font-size: 11px;
    color: var(--text-subtle);
}

.add-inline-btn {
    background: var(--accent);
    color: var(--bg-canvas);
    border: none;
    border-radius: 6px;
    width: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
}

.add-inline-btn:hover:not(:disabled) {
    background: #00e67a;
    box-shadow: 0 0 15px rgba(0, 255, 136, 0.3);
}

.add-inline-btn:disabled {
    background: var(--border-default);
    color: var(--text-subtle);
    cursor: not-allowed;
    filter: grayscale(1);
    opacity: 0.5;
}

.tags-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 48px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 6px;
    border: 1px dashed var(--border-default);
}

.tag-pill-editable {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(0, 255, 136, 0.05);
    color: var(--accent);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 800;
    border: 1px solid rgba(0, 255, 136, 0.3);
    font-family: 'JetBrains Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    box-shadow: 0 0 10px rgba(0, 255, 136, 0.05);
}

.remove-tag {
    background: transparent;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    opacity: 0.7;
}

.remove-tag:hover {
    background: rgba(0, 255, 136, 0.2);
    opacity: 1;
}

.btn-cancel {
    padding: 10px 24px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-subtle);
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
}

.btn-cancel:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
}

.btn-save {
    padding: 10px 24px;
    border-radius: 6px;
    background: var(--accent);
    border: none;
    color: var(--bg-canvas);
    font-weight: 800;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
    text-transform: uppercase;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
}

.btn-save:hover:not(:disabled) {
    background: #00e67a;
    box-shadow: 0 0 25px rgba(0, 255, 136, 0.4);
}

.btn-save:disabled {
    background-color: var(--border-default);
    color: var(--text-subtle);
    cursor: not-allowed;
    box-shadow: none;
    filter: grayscale(1);
    opacity: 0.5;
}
```

Rules deleted vs original file: `.tag-modal-overlay`, `.tag-modal-container`, `@keyframes slideUp`, `.tag-modal-header`, `.tag-modal-title`, `.close-btn`, `.close-btn:hover`, `.tag-modal-footer`. The `.tag-modal-body` rule loses its `padding: 24px`. Two rules were added for content styling that was previously implicit from the JSX structure: `.tag-input-section .input-with-button` (flex row for input + add button) and `.tag-input-section .input-hint` (hint text margin/size). The `.title-icon` rule stays alongside its twin in `reservation-modal.css` — harmless duplication; each file is imported by its own component.

- [ ] **Step 3: Verify type-check and build**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Verify the test suite still passes**

Run: `cd web && npx vitest run`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/tag-manager-modal/tag-manager-modal.tsx web/src/components/tag-manager-modal/tag-manager-modal.css
git commit -m "refactor(web): adopt ui/Modal in tag-manager-modal"
```

---

## Task 4: Adopt `ui/Modal` in `api-keys.tsx` (Create + Reveal) and delete local Modal

**Files:**
- Modify: `web/src/components/settings/api-keys.tsx`

- [ ] **Step 1: Add the `Modal` import**

Open `web/src/components/settings/api-keys.tsx` and append `import { Modal } from '../ui/Modal';` after the existing `import { FieldGroup } from '../ui/FieldGroup';` line. The import block now ends with:

```tsx
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
import { FieldGroup } from '../ui/FieldGroup';
import { Modal } from '../ui/Modal';
```

Also remove `X` from the `lucide-react` import list — it was only used by the local Modal's close button, which is going away. The `lucide-react` import block should become:

```tsx
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
```

- [ ] **Step 2: Rewrite the Create modal usage (lines 292–380 in the original file)**

Locate the block that starts with `{showCreate && (` followed by `<Modal onClose={() => setShowCreate(false)} title="Create API key">` and ends with `</Modal>` + `)}`. Replace that entire block with:

```tsx
      <Modal
        open={showCreate}
        title="Create API key"
        width={520}
        onClose={() => setShowCreate(false)}
        footer={
          <>
            <button className="reset-btn" onClick={() => setShowCreate(false)} disabled={submitting}>
              Cancel
            </button>
            <button className="save-btn" onClick={submitCreate} disabled={submitting}>
              {submitting ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
              {submitting ? 'Creating…' : 'Create key'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <FieldGroup label="Name" htmlFor="apikey-name">
            <input
              id="apikey-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="alice-laptop, ci-main, etc."
              style={input}
              autoFocus
            />
          </FieldGroup>

          <FieldGroup
            label="Scopes"
            description={
              <>
                <code>admin</code> grants full access including API-key management.{' '}
                <code>sessions</code> is required for WebDriver <code>xenon:accessKey</code>.
              </>
            }
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ALL_SCOPES.map((s) => (
                <label key={s} style={scopeLabel}>
                  <input
                    type="checkbox"
                    checked={newScopes[s]}
                    onChange={(e) =>
                      setNewScopes({ ...newScopes, [s]: e.target.checked })
                    }
                  />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup label="Rate limit (requests/min)" htmlFor="apikey-ratelimit">
            <input
              id="apikey-ratelimit"
              type="number"
              min={10}
              step={10}
              value={newRateLimit}
              onChange={(e) => setNewRateLimit(parseInt(e.target.value) || 300)}
              style={input}
            />
          </FieldGroup>

          <FieldGroup
            label="Default team"
            description={
              <>
                Keys without a team can only reach shared-pool devices. Admins can override at
                session time via <code>xenon:team</code>.
              </>
            }
            htmlFor="apikey-team"
          >
            <select
              id="apikey-team"
              value={newTeamId}
              onChange={(e) => setNewTeamId(e.target.value)}
              style={input}
            >
              <option value="">No team (shared pool only)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FieldGroup>
        </div>
      </Modal>
```

Changes vs original:
- Control is now via `open={showCreate}` instead of conditional mounting (`{showCreate && ...}`). The primitive handles the closed state.
- The trailing "Cancel / Create key" button row moves into the `footer` prop.
- The body keeps its `FieldGroup` children verbatim.

- [ ] **Step 3: Rewrite the Reveal modal usage (lines 382–429 in the original file)**

Locate the block that starts with `{revealKey && (` followed by `<Modal ... closeOnBackdrop={false}>` and ends with `</Modal>` + `)}`. Replace that entire block with:

```tsx
      <Modal
        open={!!revealKey}
        title={revealKey ? `Key created: ${revealKey.name}` : ''}
        width={560}
        onClose={() => setRevealKey(null)}
        closeOnOverlayClick={false}
        footer={
          <>
            <button
              className="save-btn"
              onClick={() => revealKey && copyKey(revealKey.raw)}
              disabled={!revealKey}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copied' : 'Copy to clipboard'}
            </button>
            <button className="reset-btn" onClick={() => setRevealKey(null)}>
              I've saved it
            </button>
          </>
        }
      >
        {revealKey && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                background: 'var(--status-busy-bg)',
                border: '1px solid var(--status-busy-border)',
                borderRadius: 6,
                padding: 12,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>This key will not be shown again.</strong> Copy it now and store it in your
                password manager, CI secret store, or client config.
              </div>
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                padding: 12,
                background: 'rgba(0,0,0,0.3)',
                borderRadius: 6,
                wordBreak: 'break-all',
                fontSize: '0.9em',
              }}
            >
              {revealKey.raw}
            </div>
          </div>
        )}
      </Modal>
```

Changes vs original:
- `open={!!revealKey}` replaces conditional mounting.
- `closeOnBackdrop={false}` → `closeOnOverlayClick={false}` (the new primitive's prop name).
- `title` is computed defensively (`revealKey ? ... : ''`) because the primitive renders even when closed — but because `open={!!revealKey}` gates the Radix portal, the title node is only rendered when `revealKey` is truthy. The empty-string branch is just belt-and-braces for the brief re-render when `revealKey` transitions to `null`.
- Copy / "I've saved it" buttons move to `footer`.
- Body content is wrapped in `{revealKey && (...)}` because `revealKey.raw` would throw on null during the close transition.

- [ ] **Step 4: Delete the local `Modal` component**

Delete the entire block starting at the original line 434 (`const Modal: React.FC<{`) through line 484 (the closing `);`). The `Modal` symbol is now imported from `../ui/Modal` (Step 1), so no other code needs to change.

After deletion, the file should go from ~516 LOC to ~463 LOC.

- [ ] **Step 5: Verify type-check and build**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Verify the test suite still passes**

Run: `cd web && npx vitest run`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/settings/api-keys.tsx
git commit -m "refactor(web): adopt ui/Modal in api-keys create and reveal flows"
```

---

## Task 5: Adopt `ui/Modal` in `teams.tsx` and delete local Modal

**Files:**
- Modify: `web/src/components/settings/teams.tsx`

- [ ] **Step 1: Add the `Modal` import**

Open `web/src/components/settings/teams.tsx`. Append `import { Modal } from '../ui/Modal';` after the existing `import { FieldGroup } from '../ui/FieldGroup';` line:

```tsx
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
import { FieldGroup } from '../ui/FieldGroup';
import { Modal } from '../ui/Modal';
```

Also remove `X` from the `lucide-react` import list — it was only used by the local Modal's close button. The `lucide-react` import block should become:

```tsx
import {
  Users,
  Plus,
  Trash2,
  ShieldAlert,
  RefreshCw,
  ArrowLeft,
  AlertTriangle,
  Smartphone,
} from 'lucide-react';
```

- [ ] **Step 2: Rewrite `CreateTeamModal` to use the primitive**

Locate the `CreateTeamModal` component (original lines 202–254). Replace the `return (...)` block only — keep everything else (props, `useState`, `submit` function). The new return body:

```tsx
  return (
    <Modal
      open={true}
      onClose={onClose}
      title="New team"
      footer={
        <>
          <button className="reset-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="save-btn" onClick={submit} disabled={submitting}>
            {submitting ? <RefreshCw className="animate-spin" size={18} /> : <Plus size={18} />}
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <FieldGroup label="Name" htmlFor="team-name">
          <input
            id="team-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="android-team, qa-ios, …"
            style={inputStyle}
            autoFocus
          />
        </FieldGroup>
      </div>
    </Modal>
  );
```

The outer `showCreate` gate in the parent component (`{showCreate && <CreateTeamModal ... />}`) is preserved — same pattern as before; the `CreateTeamModal` itself always passes `open={true}` because it's only mounted when needed. This mirrors the original behavior exactly.

Width is left at the primitive default (480), matching the old local-Modal's `width: 'min(480px, 90vw)'`.

- [ ] **Step 3: Delete the local `Modal` component**

Delete the entire block starting at the original line 530 (`const Modal: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({`) through line 577 (the closing `);`). The `Modal` symbol is now imported from `../ui/Modal`, so no other code needs to change.

After deletion, the file should go from ~588 LOC to ~540 LOC.

- [ ] **Step 4: Verify type-check and build**

Run: `cd web && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Verify the test suite still passes**

Run: `cd web && npx vitest run`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/settings/teams.tsx
git commit -m "refactor(web): adopt ui/Modal in teams create flow"
```

---

## Task 6: Final verification, bundle check, and PR

**Files:** none to modify. This task is verification + the PR itself.

- [ ] **Step 1: Run the full web build to confirm no bundler errors and to measure bundle delta**

Run: `cd web && npm run build`

Expected: build succeeds. Note the resulting asset sizes.

- [ ] **Step 2: Run the full web test suite one last time**

Run: `cd web && npx vitest run`

Expected: all tests pass.

- [ ] **Step 3: Start the dev server for the manual walkthrough**

Run this in a separate shell: `npm run dev`

This starts the Appium server with the Xenon plugin on port 4723. If the plugin is already registered it will pick up the new `lib/public/` build. If not, `npm run dev` also runs `npm run build && appium plugin install ...` — consult the CLAUDE.md dev loop section for detail.

If the walkthrough is to be performed against the Vite dev server instead (port 3000), run `npm run build:xenon && cd web && npx vite` — but the production-like walkthrough (port 4723, behind the plugin server) is preferred because that's what users actually see.

- [ ] **Step 4: Manual walkthrough — device-card modals**

Open the dashboard at `http://localhost:4723/xenon/` with auth disabled (`--plugin-xenon-auth-disabled` set in the plugin config). For a device card:

1. Click the kebab menu, choose "Reserve".
   - Confirm: calendar icon + "Reserve Device" in header, close-X on the right.
   - Confirm: focus lands in the "Reserved By" input (auto-focus).
   - Confirm: ESC closes, overlay click closes, X-button closes.
   - Confirm: after close, focus returns to the kebab trigger button.
2. Click the kebab menu, choose "Manage Tags".
   - Same focus / dismissal checks as above.
   - Confirm: the input receives focus on mount.

- [ ] **Step 5: Manual walkthrough — Settings → API Keys**

1. Navigate to Settings → API Keys. Click "Create API key".
   - Confirm primitive chrome (header, X, footer) renders correctly.
   - Confirm focus lands in the Name field (auto-focus).
   - Confirm ESC / overlay / X all close the modal.
2. Fill the form and create a key. The Reveal modal should appear.
   - **Click the overlay** → the modal must stay open (this is the `closeOnOverlayClick={false}` path).
   - Press **ESC** → modal closes. Acceptable; ESC is deliberate.
   - Re-trigger the flow. Click "I've saved it" → modal closes normally.
   - Re-trigger the flow. Click the X button → modal closes normally (X goes through `DialogPrimitive.Close`, which bypasses `onPointerDownOutside`).

- [ ] **Step 6: Manual walkthrough — Settings → Teams**

1. Navigate to Settings → Teams. Click "New team".
   - Confirm primitive chrome renders.
   - Confirm focus / ESC / overlay / X behavior.
   - Type a name and click "Create" — modal should close and the team should appear in the list.

- [ ] **Step 7: Push the branch and open the PR**

```bash
git push -u origin refactor/web-adopt-modal-primitive
```

Then open the PR. Title: `refactor(web): adopt ui/Modal primitive across standalone dialogs`. Body:

```
## Summary
- Polish ui/Modal primitive: add close-X button in header, add closeOnOverlayClick prop, refresh chrome (backdrop blur, 12px radius, softer shadow, fade+scale motion)
- Migrate five hand-rolled dialogs (reservation, tag-manager, api-keys Create + Reveal, teams Create) onto the primitive
- Delete the two local `Modal` components in settings/api-keys.tsx and settings/teams.tsx
- Delete per-modal overlay/card/header/scanline CSS rules; form-body CSS preserved
- Reveal-key modal uses closeOnOverlayClick={false} so accidental backdrop clicks don't discard the one-time secret

## Test plan
- [x] Added 3 unit tests for the new primitive behavior (close-X button, closeOnOverlayClick={false} blocks overlay pointerdown, ESC still closes under closeOnOverlayClick={false})
- [x] Existing 7 modal tests pass unchanged
- [x] Full web test suite passes
- [x] Manual walkthrough: device-card Reserve + Manage Tags, Settings API keys Create + Reveal, Settings Teams Create. Focus trap, focus restore, ESC, overlay click, X button all verified in the browser. Reveal modal refuses overlay click dismissal.
- [x] `npm run build` succeeds; bundle delta within budget

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Expected: PR opens cleanly against `main`.

---

## Self-review checklist (run before starting execution)

**Spec coverage:** every spec requirement is covered by a task.
- Primitive `closeOnOverlayClick` prop → Task 1
- Close-X button in header → Task 1
- Visual polish (overlay blur, 12px radius, soft shadow, fade+scale) → Task 1
- 3 new tests → Task 1
- Reservation modal adoption + CSS trim → Task 2
- Tag-manager modal adoption + CSS trim → Task 3
- api-keys Create modal → Task 4
- api-keys Reveal modal with `closeOnOverlayClick={false}` → Task 4
- Delete local Modal in api-keys.tsx → Task 4
- teams Create modal → Task 5
- Delete local Modal in teams.tsx → Task 5
- Manual walkthrough + bundle check + PR → Task 6

**Type consistency:** `ModalProps` fields (`open`, `title`, `onClose`, `footer?`, `children`, `width?`, `closeOnOverlayClick?`) are used identically across every call site. The prop name `closeOnOverlayClick` (not `closeOnBackdrop`, the old local-Modal name) is used consistently throughout.

**No placeholders:** every step shows the full code to write, the full command to run, and the expected outcome.
