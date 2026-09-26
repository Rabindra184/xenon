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
}

export const Pill: React.FC<PillProps> = ({ tone = 'neutral', children, title }) => (
  <span className={`pill pill-${tone}`} title={title}>
    {children}
  </span>
);
