import React from 'react';
import { MetadataCard, type MetadataRow } from './metadata-card';

interface Props {
  identity: MetadataRow[];
  run: MetadataRow[];
  result: MetadataRow[];
}

export const MetadataGrid: React.FC<Props> = ({ identity, run, result }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] divide-y md:divide-y-0 md:divide-x divide-[var(--border)]">
    <MetadataCard label="Identity" rows={identity} />
    <MetadataCard label="Run" rows={run} />
    <MetadataCard label="Result" rows={result} />
  </div>
);
