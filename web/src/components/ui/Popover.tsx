import * as React from 'react';
import './popover.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  placement?: 'bottom-start' | 'bottom-end' | 'top-end';
  children: React.ReactNode;
}

export const Popover: React.FC<PopoverProps> = ({
  open,
  onClose,
  anchorRef,
  placement = 'bottom-end',
  children,
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  React.useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const top = placement.startsWith('top') ? r.top - 8 : r.bottom + 4;
    const left = placement.endsWith('end') ? r.right : r.left;
    setPos({ top: Math.round(top), left: Math.round(left) });
  }, [open, anchorRef, placement]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={`popover popover-${placement}`}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
    >
      {children}
    </div>
  );
};
