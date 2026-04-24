import * as React from 'react';

export interface KpiTileProps {
  label: string;
  value: React.ReactNode;
  subline?: React.ReactNode;
  tone?: 'neutral' | 'ready' | 'busy' | 'error';
}

export const KpiTile: React.FC<KpiTileProps> = ({ label, value, subline, tone = 'neutral' }) => (
  <div className="kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
    {subline !== undefined && subline !== null && (
      <div className={`kpi-sub kpi-sub-${tone}`}>{subline}</div>
    )}
  </div>
);
