import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

type SpotlightProps = {
  className?: string;
  /** Diameter of the glow in px. */
  size?: number;
};

/**
 * A soft glow that follows the pointer across its parent element.
 *
 * Positioned with CSS variables rather than a spring library: framer-motion
 * 7+ needs React 18 and the dashboard is on 17. The handlers are named, so
 * cleanup removes exactly what was added — removing fresh anonymous arrows
 * (as the upstream ibelick version does) is a no-op and leaks listeners.
 */
export function Spotlight({ className, size = 320 }: SpotlightProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const onMove = (e: MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      el.style.setProperty('--spot-x', `${e.clientX - rect.left - size / 2}px`);
      el.style.setProperty('--spot-y', `${e.clientY - rect.top - size / 2}px`);
    };
    const onEnter = () => setVisible(true);
    const onLeave = () => setVisible(false);

    parent.addEventListener('mousemove', onMove);
    parent.addEventListener('mouseenter', onEnter);
    parent.addEventListener('mouseleave', onLeave);
    return () => {
      parent.removeEventListener('mousemove', onMove);
      parent.removeEventListener('mouseenter', onEnter);
      parent.removeEventListener('mouseleave', onLeave);
    };
  }, [size]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="spotlight"
      className={cn(
        'pointer-events-none absolute left-0 top-0 rounded-full blur-2xl transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={{
        width: size,
        height: size,
        transform: 'translate(var(--spot-x, -9999px), var(--spot-y, -9999px))',
        background: 'radial-gradient(circle at center, rgba(34,197,94,0.16), transparent 70%)',
      }}
    />
  );
}

/** The static angled light beam from the reference, fading in on mount. */
export function SpotlightBeam({
  className,
  fill = 'white',
}: {
  className?: string;
  fill?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn(
        'xe-beam pointer-events-none absolute z-[1] h-[169%] w-[138%] lg:w-[84%]',
        className,
      )}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 3787 2842"
      fill="none"
    >
      <g filter="url(#xe-beam-blur)">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill={fill}
          fillOpacity="0.21"
        />
      </g>
      <defs>
        <filter
          id="xe-beam-blur"
          x="0.860352"
          y="0.838989"
          width="3785.16"
          height="2840.26"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="effect1_foregroundBlur" />
        </filter>
      </defs>
    </svg>
  );
}
