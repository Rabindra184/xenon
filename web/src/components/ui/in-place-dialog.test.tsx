import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';
import { InPlaceDialog, useCloseGuard, useDialogClose } from './InPlaceDialog';

// Mirrors the real layout: app shell and page content beside the dialog, and
// the toast live region at the top level.
function App({ open, onClose = () => {} }: { open: boolean; onClose?: () => void }) {
  return (
    <>
      <div data-testid="shell">
        <nav>
          <button>Devices</button>
        </nav>
        <main>
          <button>Control</button>
          {open && (
            <InPlaceDialog labelledBy="dlg-title" onClose={onClose} data-testid="dialog">
              <h2 id="dlg-title">Pixel 8 Pro</h2>
              <button>Back</button>
              <input aria-label="Find" />
            </InPlaceDialog>
          )}
        </main>
      </div>
      <div className="toast-container" aria-live="polite" data-testid="toasts" />
    </>
  );
}

afterEach(cleanup);

describe('InPlaceDialog', () => {
  it('is a modal dialog named by its heading', () => {
    render(<App open />);
    const dialog = screen.getByRole('dialog', { name: 'Pixel 8 Pro' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('makes the background inert but leaves the toast live region usable', () => {
    render(<App open />);
    expect(screen.getByRole('button', { name: 'Control', hidden: true })).toHaveAttribute('inert');
    expect(
      screen.getByRole('button', { name: 'Devices', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
    expect(screen.getByTestId('toasts')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('dialog').closest('[inert]')).toBeNull();
  });

  it('moves focus in on open and gives it back on close', () => {
    const { rerender } = render(<App open={false} />);
    const opener = screen.getByRole('button', { name: 'Control' });
    opener.focus();
    rerender(<App open />);
    expect(screen.getByTestId('dialog')).toHaveFocus();
    rerender(<App open={false} />);
    expect(opener).not.toHaveAttribute('inert');
    expect(opener).toHaveFocus();
  });

  it('closes on Escape, but not while typing in a field', () => {
    const onClose = vi.fn();
    render(<App open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Back' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('close guard', () => {
    function Guarded({ claim, onClose }: { claim: () => boolean; onClose: () => void }) {
      function Child() {
        useCloseGuard(claim);
        const close = useDialogClose(() => undefined);
        return <button onClick={close}>Back to devices</button>;
      }
      return (
        <InPlaceDialog labelledBy="t" onClose={onClose}>
          <h2 id="t">Phone</h2>
          <Child />
        </InPlaceDialog>
      );
    }

    it('lets a guard take Escape and the close button over', () => {
      const onClose = vi.fn();
      const claim = vi.fn(() => true);
      render(<Guarded claim={claim} onClose={onClose} />);
      const back = screen.getByRole('button', { name: 'Back to devices' });
      fireEvent.keyDown(back, { key: 'Escape' });
      fireEvent.click(back);
      expect(claim).toHaveBeenCalledTimes(2);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes when the guard lets it', () => {
      const onClose = vi.fn();
      render(<Guarded claim={() => false} onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: 'Back to devices' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('is the fallback outside a dialog', () => {
      const fallback = vi.fn();
      function Outside() {
        const close = useDialogClose(fallback);
        return <button onClick={close}>Back</button>;
      }
      render(<Outside />);
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(fallback).toHaveBeenCalledTimes(1);
    });
  });
});
