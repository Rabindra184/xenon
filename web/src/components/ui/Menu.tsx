import * as React from 'react';
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
  <button
    type="button"
    className={`menu-item${danger ? ' menu-item-danger' : ''}`}
    onClick={onClick}
    disabled={disabled}
  >
    {icon && <span className="menu-item-icon">{icon}</span>}
    <span className="menu-item-label">{children}</span>
  </button>
);

export const MenuDivider: React.FC = () => <div className="menu-divider" />;

export const Menu: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="menu">{children}</div>
);
