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

export const Menu: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RovingFocusGroup.Root asChild orientation="vertical" loop>
    <div className="menu" role="menu">
      {children}
    </div>
  </RovingFocusGroup.Root>
);
