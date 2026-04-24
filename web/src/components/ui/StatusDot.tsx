import * as React from 'react';
import './status.css';

export type StatusKind = 'ready' | 'busy' | 'reserved' | 'error' | 'offline';

export interface StatusDotProps {
  kind: StatusKind;
  size?: number;
  className?: string;
}

export const StatusDot: React.FC<StatusDotProps> = ({ kind, size = 6, className }) => (
  <span
    className={`status-dot status-dot-${kind}${className ? ' ' + className : ''}`}
    style={{ width: size, height: size }}
    aria-hidden
  />
);
