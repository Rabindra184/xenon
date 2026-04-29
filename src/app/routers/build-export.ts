import { Request, Response, Router } from 'express';
import { roleGuard } from '../../middleware/roleGuard';
import { prisma } from '../../prisma';

const CSV_COLUMNS = [
  'id',
  'build_id',
  'status',
  'failure_category',
  'failure_reason',
  'device_platform',
  'device_version',
  'device_name',
  'node_id',
  'startTime',
  'endTime',
  'name',
] as const;

type CsvCell = string | number | boolean | Date | null | undefined;

function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  // Render Date objects as ISO so the CSV is locale-independent and easy to
  // parse downstream. Without this, String(new Date()) emits "Thu Apr 23
  // 2026 06:53:25 GMT+0530 …" which spreadsheets interpret poorly.
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function sessionsToJson(sessions: any[]): string {
  return JSON.stringify(sessions, null, 2);
}

export function sessionsToCsv(sessions: any[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = sessions.map((s) =>
    CSV_COLUMNS.map((col) => escapeCsvCell(s[col])).join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}

interface ExportBody {
  format?: 'json' | 'csv';
  sessionIds?: string[];
}

async function buildExportHandler(req: Request, res: Response): Promise<void> {
  const { buildId } = req.params;
  const { format = 'json', sessionIds } = (req.body || {}) as ExportBody;

  if (!buildId) {
    res.status(400).json({ error: 'buildId required' });
    return;
  }
  if (format !== 'json' && format !== 'csv') {
    res.status(400).json({ error: "format must be 'json' or 'csv'" });
    return;
  }

  const where: Record<string, unknown> = { build_id: buildId };
  if (Array.isArray(sessionIds) && sessionIds.length > 0) {
    if (sessionIds.length > 5000) {
      res.status(413).json({ error: 'sessionIds too large (max 5000)' });
      return;
    }
    where.id = { in: sessionIds };
  }

  const sessions = await prisma.session.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="build-${buildId}-sessions.csv"`,
    );
    res.send(sessionsToCsv(sessions));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="build-${buildId}-sessions.json"`,
    );
    res.send(sessionsToJson(sessions));
  }
}

const router = Router();
router.use(roleGuard('MEMBER'));
router.post('/:buildId/export', buildExportHandler);

function register(parentRouter: Router) {
  parentRouter.use('/build', router);
}

export default { register };
