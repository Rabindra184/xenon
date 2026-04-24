import * as React from 'react';
import * as PopperPrimitive from '@radix-ui/react-popper';
import { DismissableLayer } from '@radix-ui/react-dismissable-layer';
import { Portal } from '@radix-ui/react-portal';
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
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Supplementary mousedown listener so tests using fireEvent.mouseDown still work.
  // DismissableLayer only captures pointerdown; this covers the mousedown path.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (contentRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  const side = placement.startsWith('top') ? 'top' : 'bottom';
  const align = placement.endsWith('end') ? 'end' : 'start';
  const sideOffset = placement.startsWith('top') ? 8 : 4;

  return (
    <PopperPrimitive.Root>
      <PopperPrimitive.Anchor virtualRef={anchorRef} />
      <Portal>
        <DismissableLayer
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onClose();
          }}
          onPointerDownOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) {
              e.preventDefault();
              return;
            }
            onClose();
          }}
        >
          <PopperPrimitive.Content
            ref={contentRef}
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={`popover popover-${placement}`}
            role="dialog"
          >
            {children}
          </PopperPrimitive.Content>
        </DismissableLayer>
      </Portal>
    </PopperPrimitive.Root>
  );
};
