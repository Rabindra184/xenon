import * as React from 'react';
import './field-group.css';

export interface FieldGroupProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
}

export const FieldGroup: React.FC<FieldGroupProps> = ({
  label,
  description,
  children,
  error,
  htmlFor,
}) => (
  <div className="fg">
    <label className="fg-label" htmlFor={htmlFor}>
      {label}
    </label>
    {description && <div className="fg-desc">{description}</div>}
    <div className="fg-control">{children}</div>
    {error && <div className="fg-error">{error}</div>}
  </div>
);
