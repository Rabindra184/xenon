import * as React from 'react';

export type ActivityEventKind = 'session' | 'session-end' | 'session-failed' | 'node' | 'heal';

export interface ActivityEvent {
  id: string;
  ts: number;
  kind: ActivityEventKind;
  message: React.ReactNode;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const ActivityStream: React.FC<{ events: ActivityEvent[]; max?: number }> = ({
  events,
  max = 20,
}) => {
  if (events.length === 0) {
    return <div className="ov-activity-empty">No activity yet. Events stream here in real-time.</div>;
  }
  return (
    <div className="ov-activity">
      {events.slice(0, max).map((e) => (
        <div key={e.id} className="ov-activity-row">
          <span className="ov-activity-ts">{fmtTime(e.ts)}</span>
          <span className="ov-activity-msg">{e.message}</span>
        </div>
      ))}
    </div>
  );
};
