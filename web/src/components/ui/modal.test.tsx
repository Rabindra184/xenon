import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { Modal } from './Modal';

function Harness({
  startOpen = true,
  title = 'Test title',
  onClose = () => {},
}: {
  startOpen?: boolean;
  title?: React.ReactNode;
  onClose?: () => void;
}) {
  const [open, setOpen] = React.useState(startOpen);
  return (
    <>
      <button data-testid="opener" onClick={() => setOpen(true)}>
        open
      </button>
      <Modal
        open={open}
        title={title}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button data-testid="inside-1">inside 1</button>
        <button data-testid="inside-2">inside 2</button>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('renders children when open', () => {
    render(<Harness />);
    expect(screen.getByTestId('inside-1')).toBeInTheDocument();
    expect(screen.getByTestId('inside-2')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<Harness startOpen={false} />);
    expect(screen.queryByTestId('inside-1')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the overlay is clicked', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const overlay = document.querySelector('.modal-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay);
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('traps focus inside the dialog when open', async () => {
    render(<Harness />);
    await act(async () => {
      await Promise.resolve();
    });
    const active = document.activeElement as HTMLElement;
    const content = document.querySelector('.modal');
    expect(content?.contains(active)).toBe(true);
  });

  it('restores focus to the opener on close', async () => {
    function Story() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button data-testid="opener" onClick={() => setOpen(true)}>
            open
          </button>
          <Modal open={open} title="t" onClose={() => setOpen(false)}>
            <button data-testid="inside">inside</button>
          </Modal>
        </>
      );
    }
    render(<Story />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it('wires aria-labelledby to the title element even when title is JSX', () => {
    const jsxTitle = (
      <span>
        Complex <em>title</em>
      </span>
    );
    render(<Harness title={jsxTitle} />);
    const dialog = document.querySelector('.modal') as HTMLElement;
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const labelEl = document.getElementById(labelId ?? '');
    expect(labelEl).not.toBeNull();
    expect(labelEl?.textContent).toContain('Complex');
    expect(labelEl?.textContent).toContain('title');
  });
});
