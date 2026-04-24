import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Popover } from './Popover';
import { Menu, MenuItem } from './Menu';

function Harness({ startOpen = true }: { startOpen?: boolean }) {
  const anchor = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(startOpen);
  return (
    <>
      <button ref={anchor}>anchor</button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor}>
        <Menu>
          <MenuItem onClick={() => {}}>one</MenuItem>
        </Menu>
      </Popover>
    </>
  );
}

describe('Popover', () => {
  it('renders when open', () => {
    render(<Harness />);
    expect(screen.getByText('one')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<Harness />);
    expect(screen.getByText('one')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('one')).not.toBeInTheDocument();
  });

  it('closes on outside click', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <Harness />
      </div>,
    );
    expect(screen.getByText('one')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('one')).not.toBeInTheDocument();
  });
});
