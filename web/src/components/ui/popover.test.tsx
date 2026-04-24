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

describe('Popover layered dismissal', () => {
  it('Escape closes only the top popover when two are stacked', () => {
    function Outer() {
      const outerAnchor = React.useRef<HTMLButtonElement>(null);
      const innerAnchor = React.useRef<HTMLButtonElement>(null);
      const [outerOpen, setOuterOpen] = React.useState(true);
      const [innerOpen, setInnerOpen] = React.useState(true);
      return (
        <>
          <button ref={outerAnchor}>outer anchor</button>
          <button ref={innerAnchor}>inner anchor</button>
          <Popover open={outerOpen} onClose={() => setOuterOpen(false)} anchorRef={outerAnchor}>
            <div data-testid="outer-body">outer body</div>
          </Popover>
          <Popover open={innerOpen} onClose={() => setInnerOpen(false)} anchorRef={innerAnchor}>
            <div data-testid="inner-body">inner body</div>
          </Popover>
        </>
      );
    }
    render(<Outer />);
    expect(screen.getByTestId('outer-body')).toBeInTheDocument();
    expect(screen.getByTestId('inner-body')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('inner-body')).not.toBeInTheDocument();
    expect(screen.getByTestId('outer-body')).toBeInTheDocument();
  });
});
