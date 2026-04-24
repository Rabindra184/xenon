import * as React from 'react';
import './setting-card.css';

export interface SettingCardProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}

export const SettingCard: React.FC<SettingCardProps> = ({
  icon,
  title,
  description,
  hint,
  children,
}) => (
  <div className="setting-card">
    <div className="setting-card-header">
      {icon}
      <h4>{title}</h4>
    </div>
    {description && <p className="setting-card-description">{description}</p>}
    <div className="setting-card-field">{children}</div>
    {hint && <div className="setting-card-hint">{hint}</div>}
  </div>
);
