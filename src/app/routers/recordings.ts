import { Router, Request, Response } from 'express';
import { Container } from 'typedi';
import {
  RecordingOrchestrator,
  RecordingError,
} from '../../services/recording/RecordingOrchestrator';
import { ProofBundleService } from '../../services/recording/proof-bundle';
import { AnnotationRenderService } from '../../services/recording/annotation-render';
import { RecordingStore } from '../../services/recording/recording-store';
import log from '../../logger';

const recLog = log.scope('RecordingsRouter');
const router = Router();

router.post('/recordings', async (req: Request, res: Response) => {
  const { udids, sessionId, note } = req.body ?? {};
  if (!Array.isArray(udids) || udids.length === 0) {
    return res.status(400).json({ error: 'udids must be a non-empty array' });
  }
  for (const u of udids) {
    if (typeof u !== 'string' || u.length === 0) {
      return res.status(400).json({ error: 'every udid must be a non-empty string' });
    }
  }
  try {
    const out = await Container.get(RecordingOrchestrator).start({
      udids,
      sessionId,
      note,
    });
    return res.status(202).json(out);
  } catch (e: any) {
    if (e instanceof RecordingError) {
      if (e.code === 'concurrency_cap') {
        return res.status(409).json({
          error: 'concurrency_cap',
          limit: e.limit,
          active: e.active,
          message: `Server-wide recording cap reached (${e.active}/${e.limit}).`,
        });
      }
      const busyDevices = e.busyDevices ?? [];
      return res.status(409).json({
        error: 'device_busy',
        busyDevices,
        message: `${busyDevices.length} of ${udids.length} selected devices are busy. Recording was not started.`,
      });
    }
    recLog.error(`POST /recordings failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/stop', async (req: Request, res: Response) => {
  try {
    const out = await Container.get(RecordingOrchestrator).stop(req.params.groupId);
    res.json(out);
  } catch (e: any) {
    recLog.error(`POST /recordings/:groupId/stop failed: ${e?.message}`);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/bookmark', async (req: Request, res: Response) => {
  const { recordingId, timecodeMs, label, note } = req.body ?? {};
  if (typeof recordingId !== 'string' || typeof label !== 'string' || typeof timecodeMs !== 'number') {
    return res
      .status(400)
      .json({ error: 'recordingId (string), timecodeMs (number) and label (string) are required' });
  }
  try {
    const out = await Container.get(RecordingOrchestrator).addBookmark(
      req.params.groupId,
      recordingId,
      timecodeMs,
      label,
      note,
    );
    res.status(201).json(out);
  } catch (e: any) {
    recLog.error(`bookmark failed: ${e?.message}`);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/annotation', async (req: Request, res: Response) => {
  const { recordingId, timecodeMs, shape, geometry, color, text, author } = req.body ?? {};
  if (
    typeof recordingId !== 'string' ||
    typeof timecodeMs !== 'number' ||
    typeof shape !== 'string' ||
    typeof geometry !== 'string' ||
    typeof color !== 'string'
  ) {
    return res.status(400).json({
      error: 'recordingId, timecodeMs, shape, geometry, color are required',
    });
  }
  try {
    const out = await Container.get(RecordingOrchestrator).addAnnotation(
      req.params.groupId,
      recordingId,
      { timecodeMs, shape, geometry, color, text, author },
    );
    res.status(201).json(out);
  } catch (e: any) {
    recLog.error(`annotation failed: ${e?.message}`);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.get('/recordings/:groupId', async (req: Request, res: Response) => {
  try {
    const recs = await Container.get(RecordingStore).listGroup(req.params.groupId);
    res.json({ groupId: req.params.groupId, recordings: recs });
  } catch (e: any) {
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.get('/recordings/:groupId/bundle.zip', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="proof-${req.params.groupId}.zip"`,
  );
  const archive = Container.get(ProofBundleService).streamBundleZip(req.params.groupId);
  archive.on('error', (err) => {
    recLog.error(`bundle stream error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal', message: err.message });
    } else {
      res.destroy();
    }
  });
  archive.pipe(res);
});

router.get(
  '/recordings/:groupId/exports/annotated.mp4',
  async (req: Request, res: Response) => {
    const recordingId = String(req.query.recordingId ?? '');
    if (!recordingId) {
      return res.status(400).json({ error: 'recordingId query param is required' });
    }
    try {
      const { stream, cleanup } = await Container.get(
        AnnotationRenderService,
      ).renderForRecording(recordingId);
      res.setHeader('Content-Type', 'video/mp4');
      stream.pipe(res);
      res.on('close', cleanup);
      stream.on('end', cleanup);
    } catch (e: any) {
      recLog.error(`annotated.mp4 render failed: ${e?.message}`);
      res.status(500).json({ error: 'render_failed', message: e?.message });
    }
  },
);

function register(parentRouter: Router) {
  parentRouter.use('/', router);
}

export default { register };
