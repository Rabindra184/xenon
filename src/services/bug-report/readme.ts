import { Manifest } from './types';

function platformDisplay(p: string): string {
  if (p === 'android') return 'Android';
  if (p === 'ios') return 'iOS';
  return p;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function buildReadme(m: Manifest, aiSummary: string | null): string {
  const lines: string[] = [];
  lines.push('# Xenon Bug Report');
  lines.push('');
  lines.push(
    `**Session:** ${m.session.id} (${m.session.status}, ${formatDuration(m.session.durationMs)})`,
  );
  lines.push(
    `**Device:** ${m.device.name ?? m.device.udid} / ${platformDisplay(m.device.platform)} ${m.device.osVersion}`,
  );
  lines.push(`**Generated:** ${m.generatedAt}`);
  lines.push(
    `**Mode:** ${m.mode}${m.mode === 'slice' ? ` (last ${Math.round(m.window.requestedDurationMs / 1000)}s)` : ''}`,
  );
  lines.push('');
  lines.push('## AI Summary');
  lines.push('');
  lines.push(aiSummary ?? '(not available)');
  lines.push('');
  lines.push('## Last command');
  lines.push('');
  lines.push(m.lastCommand?.errorMessage ?? '(no error captured)');
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  if (m.artifacts.video) lines.push(`- ${m.artifacts.video}`);
  lines.push(`- ${m.artifacts.logs}`);
  if (m.artifacts.network) lines.push(`- ${m.artifacts.network}`);
  if (m.artifacts.aiSummary) lines.push(`- ${m.artifacts.aiSummary}`);
  for (const s of m.artifacts.screenshots) lines.push(`- ${s}`);
  if (m.warnings.length) {
    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    for (const w of m.warnings) lines.push(`- ${w}`);
  }
  lines.push('');
  return lines.join('\n');
}
