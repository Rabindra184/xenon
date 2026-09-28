import * as React from 'react';
import './pill.css';

export type PillTone =
  | 'neutral'
  | 'accent'
  | 'ready'
  | 'busy'
  | 'reserved'
  | 'error'
  | 'offline'
  // Amber, for "needs attention" readings (battery, temperature). Not
  // 'reserved': that is the blue of a reservation.
  | 'warning';

export interface PillProps {
  tone?: PillTone;
  children: React.ReactNode;
  title?: string;
  /** Added after the tone class, for a caller that restyles the pill in context. */
  className?: string;
}

export const Pill: React.FC<PillProps> = ({ tone = 'neutral', children, title, className }) => (
  <span className={`pill pill-${tone}${className ? ` ${className}` : ''}`} title={title}>
    {children}
  </span>
);
