import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import Tesseract, { PSM } from 'tesseract.js';
import * as ocrData from '../../src/services/ocr/ocrData';
import { createOcrWorker, OCR_DATA_FILE } from '../../src/services/ocr/ocrData';
import {
  OmniVisionService,
  OCR_RECOGNIZE_TIMEOUT_MS,
} from '../../src/services/omni-vision/OmniVisionService';

/**
 * OCR waited on a recognize job with no limit, behind a lock every OCR caller
 * shares (the OCR healing tier inside a findElement included), so one job
 * that never finished hung them all. And a worker whose parameters couldn't be
 * set after it started was neither kept nor ended, and its failure wasn't
 * remembered, so every OCR call started (and leaked) another. Through 2.36.
 */
describe('OCR time limit and worker start', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    sinon.restore();
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const empty = { data: { text: '', words: [], hocr: '', tsv: '' } };
  const fakeWorker = (recognize: () => Promise<unknown>) => ({
    setParameters: sinon.stub().resolves(),
    recognize: sinon.stub().callsFake(recognize),
    terminate: sinon.stub().resolves(),
  });

  /** A service whose image step is a pass-through and whose worker is `worker`. */
  function serviceWith(worker: ReturnType<typeof fakeWorker>) {
    const service = new OmniVisionService();
    sinon.stub(service as any, 'preprocessImage').callsFake(async (b: any) => b);
    (service as any).sharedWorker = worker;
    return service;
  }

  const settle = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (err: Error) => err,
    );

  async function until(clock: sinon.SinonFakeTimers, check: () => boolean) {
    for (let i = 0; i < 100 && !check(); i++) await clock.tickAsync(0);
    expect(check(), 'the condition was never reached').to.equal(true);
  }

  it('fails a recognize that never finishes, ends that worker and frees the lock', async () => {
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hung = fakeWorker(() => new Promise(() => undefined));
    const service = serviceWith(hung);

    const first = settle((service as any).performOcr(Buffer.alloc(1000)));
    await until(clock, () => hung.recognize.called);
    await clock.tickAsync(OCR_RECOGNIZE_TIMEOUT_MS);
    const err = await first;

    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.match(/OCR .*30 s/);
    expect(hung.terminate.calledOnce).to.equal(true);
    expect((service as any).sharedWorker).to.equal(null);
    expect((service as any).workerBusy).to.equal(false);
  });

  it('lets a caller waiting on the lock through, on a fresh worker', async () => {
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hung = fakeWorker(() => new Promise(() => undefined));
    const fresh = fakeWorker(async () => empty);
    const service = serviceWith(hung);
    const start = sinon.stub(ocrData, 'createOcrWorker').resolves(fresh as any);

    const first = settle((service as any).performOcr(Buffer.alloc(1000)));
    await until(clock, () => hung.recognize.called);
    const second = (service as any).performOcr(Buffer.alloc(1000));
    await clock.tickAsync(OCR_RECOGNIZE_TIMEOUT_MS + 200);

    expect(await first).to.be.instanceOf(Error);
    expect(await second).to.deep.equal({ text: '', words: [] });
    expect(start.calledOnce).to.equal(true);
    expect(fresh.recognize.calledOnce).to.equal(true);
  });

  it('a recognize that answers in time is unchanged and keeps its worker', async () => {
    const worker = fakeWorker(async () => empty);
    const service = serviceWith(worker);
    expect(await (service as any).performOcr(Buffer.alloc(1000))).to.deep.equal({
      text: '',
      words: [],
    });
    expect(worker.terminate.called).to.equal(false);
    expect((service as any).sharedWorker).to.equal(worker);
  });

  it('starts its worker with sparse-text page segmentation', async () => {
    const worker = fakeWorker(async () => empty);
    const start = sinon.stub(ocrData, 'createOcrWorker').resolves(worker as any);
    const service = serviceWith(worker);
    (service as any).sharedWorker = null;
    await (service as any).performOcr(Buffer.alloc(1000));
    expect(start.firstCall.args[1]).to.deep.equal({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  });

  describe('a worker whose parameters cannot be set', () => {
    const dataDir = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-ocr-params-'));
      tmpDirs.push(dir);
      fs.copyFileSync(OCR_DATA_FILE, path.join(dir, 'eng.traineddata.gz'));
      return dir;
    };

    it('is ended, and its failure remembered as a start failure is', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const worker = {
        setParameters: sinon.stub().rejects(new Error('unknown parameter')),
        recognize: sinon.stub(),
        terminate: sinon.stub().resolves(),
      };
      const createWorker = sinon.stub(Tesseract, 'createWorker').resolves(worker as any);
      const dir = dataDir();
      const params = { tessedit_pageseg_mode: PSM.SPARSE_TEXT };

      const first = await settle(createOcrWorker(dir, params));
      expect((first as Error).message).to.include('unknown parameter');
      expect(worker.terminate.calledOnce).to.equal(true);

      const again = await settle(createOcrWorker(dir, params));
      expect((again as Error).message).to.include('unknown parameter');
      expect(createWorker.callCount).to.equal(1);

      clock.tick(ocrData.OCR_START_RETRY_MS + 1);
      await settle(createOcrWorker(dir, params));
      expect(createWorker.callCount).to.equal(2);
    });

    it('a worker whose parameters are set is returned and kept running', async () => {
      const worker = {
        setParameters: sinon.stub().resolves(),
        recognize: sinon.stub(),
        terminate: sinon.stub().resolves(),
      };
      sinon.stub(Tesseract, 'createWorker').resolves(worker as any);
      const started = await createOcrWorker(dataDir(), {
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      expect(started).to.equal(worker);
      expect(worker.setParameters.calledOnceWith({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })).to.be
        .true;
      expect(worker.terminate.called).to.equal(false);
    });
  });
});
