import * as React from 'react';
import './card.css';

export interface CardProps {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  action?: React.ReactNode;
  padded?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  header,
  footer,
  action,
  padded = true,
  className,
  children,
}) => (
  <div className={`card${className ? ' ' + className : ''}`}>
    {(header || action) && (
      <div className="card-header">
        <div className="card-header-title">{header}</div>
        {action && <div className="card-header-action">{action}</div>}
      </div>
    )}
    <div className={padded ? 'card-body' : 'card-body-flush'}>{children}</div>
    {footer && <div className="card-footer">{footer}</div>}
  </div>
);
