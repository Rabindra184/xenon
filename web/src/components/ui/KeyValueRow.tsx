import * as React from 'react';
import './key-value-row.css';

export interface KeyValueRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  valueClassName?: string;
}

export const KeyValueRow: React.FC<KeyValueRowProps> = ({
  label,
  value,
  mono,
  valueClassName,
}) => (
  <div className="kv-row">
    <span className="kv-label">{label}</span>
    <span
      className={`kv-value${mono ? ' kv-value-mono' : ''}${
        valueClassName ? ' ' + valueClassName : ''
      }`}
    >
      {value}
    </span>
  </div>
);
