import * as React from 'react';
import * as RovingFocusGroup from '@radix-ui/react-roving-focus';
import './popover.css';

export interface MenuItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  children,
  onClick,
  danger,
  disabled,
}) => (
  <RovingFocusGroup.Item asChild focusable={!disabled} active={false}>
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? ' menu-item-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span className="menu-item-label">{children}</span>
    </button>
  </RovingFocusGroup.Item>
);

export const MenuDivider: React.FC = () => <div className="menu-divider" role="separator" />;

function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  const container = event.currentTarget;
  const items = Array.from(
    container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  );
  if (items.length === 0) return;

  const current = document.activeElement as HTMLElement;
  const currentIndex = items.indexOf(current);

  let next: HTMLElement | undefined;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    next = currentIndex === -1 ? items[0] : items[(currentIndex + 1) % items.length];
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    next =
      currentIndex === -1
        ? items[items.length - 1]
        : items[(currentIndex - 1 + items.length) % items.length];
  } else if (event.key === 'Home') {
    event.preventDefault();
    next = items[0];
  } else if (event.key === 'End') {
    event.preventDefault();
    next = items[items.length - 1];
  }

  if (next) {
    next.focus();
  }
}

export const Menu: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RovingFocusGroup.Root asChild orientation="vertical" loop>
    <div className="menu" role="menu" onKeyDown={handleMenuKeyDown}>
      {children}
    </div>
  </RovingFocusGroup.Root>
);
