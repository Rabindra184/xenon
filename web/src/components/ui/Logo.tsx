import * as React from 'react';

/**
 * The Xenon wordmark in the variant for the current theme. Both images are
 * rendered and CSS shows one ([data-theme] in index.css), so the switch is
 * instant and there's no flash while React catches up. The dark-theme logo
 * draws "XENON" in near-white, which vanishes on a light surface.
 */
export function Logo({ className, alt = 'Xenon' }: { className?: string; alt?: string }) {
  const base = import.meta.env.BASE_URL;
  return (
    <>
      <img src={`${base}logo.svg`} alt={alt} className={`logo-for-dark ${className ?? ''}`} />
      <img src={`${base}logo-light.svg`} alt={alt} className={`logo-for-light ${className ?? ''}`} />
    </>
  );
}
