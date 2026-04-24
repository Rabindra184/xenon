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

  // Supplementary mousedown listener so the original `closes on outside click`
  // test (which uses fireEvent.mouseDown) continues to pass unmodified and so we
  // preserve the pre-refactor Popover's outside-click dismissal behavior exactly.
  // Radix DismissableLayer only listens to pointerdown.
  //
  // Behavioral note: unlike DismissableLayer.onEscapeKeyDown — which fires only
  // on the topmost layer (see the 'layered dismissal' test) — this handler has
  // no layer-stack awareness. Two stacked popovers will both close on an outside
  // click. Layered outside-click dismissal is explicitly out of scope per the
  // Task 3 plan; the layered requirement is ESC-only.
  //
  // The `if (!open) return` guard inside the handler protects against a real-
  // browser race: DismissableLayer's onPointerDownOutside runs inside a
  // flushSync, synchronously unmounting this component, but this useEffect's
  // cleanup runs on the next microtask — so the mousedown handler can still
  // fire with a stale contentRef between those two steps.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!open) return; // guard against stale handler after flushSync+unmount
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
