import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { Menu, MenuItem } from '../ui/Menu';
import './filter-menu.css';

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** A quieter second line, e.g. what "Virtual" covers. */
  note?: string;
  count: number;
}

interface FilterMenuProps<T extends string> {
  /** "Platform": the trigger's name, and "Platform: iOS" once set. */
  name: string;
  value: T;
  /** The option that means "not filtering", e.g. 'all'. */
  anyValue: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
}

/**
 * A filter as a menu: a quiet "+ Platform" button while unset, a tinted
 * "Platform: iOS" chip with its own × once set. Three rows of equal-weight
 * segments read as busy; this keeps the choice visible without the pills.
 */
export function FilterMenu<T extends string>({
  name,
  value,
  anyValue,
  options,
  onChange,
}: FilterMenuProps<T>) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const isSet = value !== anyValue;
  const current = options.find((o) => o.value === value);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // The menu mounts in a portal; focus the current choice as it appears, so
  // the arrow keys work straight away.
  const focusCurrent = React.useCallback((node: HTMLDivElement | null) => {
    const item =
      node?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      node?.querySelector<HTMLElement>('[role="menuitemradio"]');
    item?.focus();
  }, []);

  return (
    <span ref={wrapRef} className={`fm${isSet ? ' fm-set' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="fm-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {isSet ? (
          <>
            <span className="fm-name">{name}:</span> {current?.label ?? value}
          </>
        ) : (
          <>
            <Plus size={12} aria-hidden="true" />
            {name}
          </>
        )}
      </button>
      {isSet && (
        <button
          type="button"
          className="fm-clear"
          aria-label={`Clear ${name.toLowerCase()} filter`}
          onClick={() => {
            onChange(anyValue);
            close();
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
      <Popover open={open} onClose={close} anchorRef={wrapRef} placement="bottom-start">
        <div ref={focusCurrent}>
          <Menu>
            {options.map((o) => (
              <MenuItem
                key={o.value}
                checked={o.value === value}
                note={o.note}
                trailing={<span className="fm-count">{o.count}</span>}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                {o.label}
              </MenuItem>
            ))}
          </Menu>
        </div>
      </Popover>
    </span>
  );
}
