import { Service } from 'typedi';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import pkg from '../../../package.json';
import log, { redactSecrets } from '../../logger';
import { prisma } from '../../prisma';
import { config } from '../../config';
import { resolveWindow } from './window';
import { buildManifest } from './manifest';
import { buildReadme } from './readme';
import { collectHar } from './har-collector';
import { sliceVideo } from './video-slice';
import {
  BugReportOptions,
  Manifest,
  ManifestArtifacts,
  SLICE_DEFAULT_SEC,
} from './types';

export interface BundleEntry {
  name: string;
  source: { kind: 'buffer'; data: Buffer } | { kind: 'file'; path: string };
}

export interface AssembledBundle {
  filename: string;
  manifest: Manifest;
  entries: BundleEntry[];
  cleanup: () => Promise<void>;
}

@Service()
export class BugReportService {
  private logger = log.scope('BugReportService');

  async assemble(opts: BugReportOptions): Promise<AssembledBundle> {
    const session = (await prisma.session.findUnique({ where: { id: opts.sessionId } })) as any;
    if (!session) throw new Error(`Session ${opts.sessionId} not found`);

    const warnings: string[] = [];
    const window = resolveWindow(session, opts.mode, opts.windowSec ?? SLICE_DEFAULT_SEC);

    const logs = await this.collectLogs(opts.sessionId, window.startedAt, window.endedAt);

    const harText = collectHar(opts.sessionId, config.sessionAssetsPath);
    if (!harText) warnings.push('no network capture for this session');

    const aiSummary = (session.ai_analysis as string | null) ?? null;

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xenon-bugreport-'));
    const cleanups: Array<() => Promise<void>> = [
      async () => {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      },
    ];
    let videoEntryPath: string | null = null;
    if (session.video_recording) {
      const fullVideoPath = path.join(config.sessionAssetsPath, session.video_recording);
      if (fs.existsSync(fullVideoPath)) {
        if (opts.mode === 'full') {
          videoEntryPath = fullVideoPath;
        } else {
          const startMs = new Date(session.startTime).getTime();
          const sliceStart = (new Date(window.startedAt).getTime() - startMs) / 1000;
          const sliceEnd = (new Date(window.endedAt).getTime() - startMs) / 1000;
          const out = path.join(tmpDir, 'video.mp4');
          const result = await sliceVideo(fullVideoPath, Math.max(0, sliceStart), sliceEnd, out);
          if (result.ok) {
            videoEntryPath = out;
          } else {
            warnings.push(`video slice failed: ${result.error}`);
          }
        }
      } else {
        warnings.push('recorded video not found on disk');
      }
    }

    const artifacts: ManifestArtifacts = {
      video: videoEntryPath ? 'video.mp4' : null,
      logs: 'logs.txt',
      network: harText ? 'network.har' : null,
      aiSummary: aiSummary ? 'ai-summary.txt' : null,
      screenshots: [],
    };

    const manifest = buildManifest({
      session,
      window,
      mode: opts.mode,
      xenonVersion: (pkg as any).version ?? '0.0.0',
      generatedAt: new Date().toISOString(),
      artifacts,
      warnings,
    });

    const readme = buildReadme(manifest, aiSummary);

    const entries: BundleEntry[] = [
      {
        name: 'manifest.json',
        source: { kind: 'buffer', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
      },
      { name: 'README.md', source: { kind: 'buffer', data: Buffer.from(readme) } },
      { name: 'logs.txt', source: { kind: 'buffer', data: Buffer.from(logs) } },
    ];
    if (videoEntryPath) {
      entries.push({ name: 'video.mp4', source: { kind: 'file', path: videoEntryPath } });
    }
    if (harText) {
      entries.push({ name: 'network.har', source: { kind: 'buffer', data: Buffer.from(harText) } });
    }
    if (aiSummary) {
      entries.push({
        name: 'ai-summary.txt',
        source: { kind: 'buffer', data: Buffer.from(aiSummary) },
      });
    }

    const filename = `bugreport-${opts.sessionId}-${manifest.generatedAt.replace(/[:.]/g, '-')}.zip`;

    return {
      filename,
      manifest,
      entries,
      cleanup: async () => {
        for (const c of cleanups) {
          try {
            await c();
          } catch (e: any) {
            this.logger.warn(`cleanup failed: ${e.message}`);
          }
        }
      },
    };
  }

  private async collectLogs(
    sessionId: string,
    startIso: string,
    endIso: string,
  ): Promise<string> {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const rows = (await prisma.sessionLog.findMany({
      where: { session_id: sessionId, createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
    })) as Array<{ createdAt: Date; title: string | null; response: string | null }>;
    const lines = rows.map(
      (r) => `${r.createdAt.toISOString()}  ${r.title ?? ''}  ${r.response ?? ''}`,
    );
    return redactSecrets(lines.join('\n'));
  }
}
