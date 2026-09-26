import * as React from 'react';
import * as RovingFocusGroup from '@radix-ui/react-roving-focus';
import { Check } from 'lucide-react';
import './popover.css';

export interface MenuItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A single choice in a list (menuitemradio); true marks the chosen one. */
  checked?: boolean;
  /** A quieter second line under the label. */
  note?: string;
  /** Right-aligned content, such as a count. */
  trailing?: React.ReactNode;
}

export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  children,
  onClick,
  danger,
  disabled,
  checked,
  note,
  trailing,
}) => (
  <RovingFocusGroup.Item asChild focusable={!disabled} active={false}>
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={`menu-item${danger ? ' menu-item-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {checked !== undefined && (
        <span className="menu-item-check" aria-hidden="true">
          {checked && <Check size={12} />}
        </span>
      )}
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span className="menu-item-label">
        {children}
        {note && <span className="menu-item-note">{note}</span>}
      </span>
      {trailing !== undefined && <span className="menu-item-trailing">{trailing}</span>}
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
