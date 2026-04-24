import * as React from 'react';
import { StatusDot, StatusKind } from './StatusDot';
import './status.css';

export interface StatusCodeProps {
  kind: StatusKind;
  showDot?: boolean;
  children: React.ReactNode;
}

export const StatusCode: React.FC<StatusCodeProps> = ({ kind, showDot, children }) => (
  <span className={`status-code status-code-${kind}`}>
    {showDot && <StatusDot kind={kind} />}
    <span className="status-code-label">{String(children).toUpperCase()}</span>
  </span>
);
