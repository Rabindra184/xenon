import 'reflect-metadata';
import { expect } from 'chai';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import sinon from 'sinon';
import Tesseract from 'tesseract.js';
import { Container } from 'typedi';
import pkg from '../../package.json';
import {
  createOcrWorker,
  OCR_DATA_DIR,
  OCR_DATA_FILE,
  OCR_DATA_SHA256,
  ocrWorkerOptions,
} from '../../src/services/ocr/ocrData';
import { OcrHealingProvider } from '../../src/services/healing/OcrHealingProvider';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * tesseract.js downloads its English data (eng.traineddata) from
 * cdn.jsdelivr.net the first time a worker starts, and caches it in the
 * server's working directory. A server with no internet couldn't run OCR at
 * all: the first OCR call never finished, and every later one waited for it.
 * One with internet left a 5 MB eng.traineddata wherever it was started (the
 * home directory, ~/.appium).
 *
 * The data now ships with the plugin, read from there and cached nowhere.
 */
describe('OCR without the internet', () => {
  // The upstream file, @tesseract.js-data/eng@1.0.0 4.0.0_best_int/eng.traineddata.gz:
  // what tesseract.js 7 downloads by default (LSTM only).
  const UPSTREAM_SHA256 = '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91';
  const tmpDirs: string[] = [];
  const tmpDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-ocr-'));
    tmpDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    sinon.restore();
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A white image with `text` on it, as a phone's screenshot would have. */
  const imageOf = (text: string) =>
    sharp({ create: { width: 900, height: 220, channels: 3, background: '#ffffff' } })
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="220">` +
              `<text x="40" y="140" font-family="Helvetica, Arial, sans-serif" font-size="96" fill="#000">${text}</text>` +
              `</svg>`,
          ),
        },
      ])
      .png()
      .toBuffer();

  describe('the English data', () => {
    it('ships with the plugin, byte for byte the file tesseract.js would download', () => {
      expect(OCR_DATA_FILE).to.equal(path.join(OCR_DATA_DIR, 'eng.traineddata.gz'));
      const sha = crypto.createHash('sha256').update(fs.readFileSync(OCR_DATA_FILE)).digest('hex');
      expect(sha).to.equal(UPSTREAM_SHA256);
      expect(OCR_DATA_SHA256).to.equal(UPSTREAM_SHA256);
      const readme = fs.readFileSync(path.join(OCR_DATA_DIR, 'README.md'), 'utf8');
      expect(readme).to.include(UPSTREAM_SHA256);
    });

    it('is copied into lib/ by the build, which is what the npm package ships', () => {
      const copy = (pkg as any).scripts['build:copy'] as string;
      expect(copy).to.include('mkdir -p lib/src/services/ocr/vendor');
      expect(copy).to.include('cp src/services/ocr/vendor/*.gz');
      expect((pkg as any).files).to.include('lib');
    });

    it('is read from there, never fetched, and cached nowhere', () => {
      const options = ocrWorkerOptions();
      expect(options.langPath).to.equal(OCR_DATA_DIR);
      expect(String(options.langPath)).not.to.match(/^[a-z]+:\/\//i);
      expect(options.cacheMethod).to.equal('none');
      expect(options.gzip).to.equal(true);
    });
  });

  describe('a real OCR worker', () => {
    let cwd: string;

    beforeEach(() => {
      cwd = process.cwd();
    });

    afterEach(() => {
      process.chdir(cwd);
    });

    it('reads text, and writes nothing into the working directory', async () => {
      const workDir = tmpDir();
      process.chdir(workDir);
      const worker = await createOcrWorker();
      try {
        const { data } = await worker.recognize(await imageOf('Sign in'));
        expect(data.text).to.match(/sign\s*in/i);
      } finally {
        await worker.terminate();
      }
      expect(fs.readdirSync(workDir)).to.deep.equal([]);
    });

    it('fails with a reason, rather than wait for ever, when the data is missing', async () => {
      const started = Date.now();
      const failure = await createOcrWorker(tmpDir()).then(
        () => expect.fail('a worker with no data should not start'),
        (err: Error) => err,
      );
      expect(failure.message).to.include('eng.traineddata.gz');
      expect(Date.now() - started).to.be.below(5000);
    });

    // Given data it can't load, tesseract.js 7 throws from its own message
    // handler, and the server exits on an uncaught exception: the data is
    // checked before a worker sees it.
    for (const [damage, bytes] of [
      ['not tesseract data at all', () => Buffer.from('not tesseract data')],
      ['cut short', () => fs.readFileSync(OCR_DATA_FILE).subarray(0, 100_000)],
    ] as const) {
      it(`fails with a reason, before any worker starts, when the data is ${damage}`, async () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, 'eng.traineddata.gz'), bytes());
        const createWorker = sinon.spy(Tesseract, 'createWorker');
        const failure = await createOcrWorker(dir).then(
          () => expect.fail('a worker with damaged data should not start'),
          (err: Error) => err,
        );
        expect(failure.message).to.include('damaged');
        expect(createWorker.called).to.equal(false);
      });
    }
  });

  describe('a worker that will not start', () => {
    /** A directory holding a good copy of the data, so this test's memory is its own. */
    const dataDir = () => {
      const dir = tmpDir();
      fs.copyFileSync(OCR_DATA_FILE, path.join(dir, 'eng.traineddata.gz'));
      return dir;
    };

    it('is remembered for a minute: OCR fails at once rather than start another', async () => {
      // tesseract.js hands back no worker when its start fails, so its thread
      // can't be ended; starting one per OCR call would leave one per call.
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const createWorker = sinon
        .stub(Tesseract, 'createWorker')
        .callsFake((_langs: any, _oem: any, options: any) => {
          setTimeout(() => options.errorHandler('the OCR engine failed to load'), 5);
          return new Promise(() => undefined) as any;
        });
      const dir = dataDir();
      const reason = (p: Promise<unknown>) =>
        p.then(
          () => expect.fail('the worker should not start'),
          (err: Error) => err.message,
        );

      expect(await reason(createOcrWorker(dir))).to.include('the OCR engine failed to load');
      expect(await reason(createOcrWorker(dir))).to.include('the OCR engine failed to load');
      expect(createWorker.callCount).to.equal(1);

      clock.tick(60_001);
      await reason(createOcrWorker(dir));
      expect(createWorker.callCount).to.equal(2);
    });
  });

  describe('every place that runs OCR', () => {
    let restoreContainer: () => void;

    beforeEach(() => {
      restoreContainer = saveRegistrations(OmniVisionService);
    });

    afterEach(() => {
      restoreContainer();
    });

    it('the OCR healing tier reads the shipped data, and ends its worker', async () => {
      const worker = {
        recognize: sinon.stub().resolves({ data: { text: '', words: [] } }),
        terminate: sinon.stub().resolves(),
      };
      const createWorker = sinon.stub(Tesseract, 'createWorker').resolves(worker as any);
      await new OcrHealingProvider().heal({
        screenshotBase64: (await imageOf('Login')).toString('base64'),
        selector: "//*[@text='Login']",
        strategy: 'xpath',
        driver: {},
      } as any);
      expect(createWorker.calledOnce).to.equal(true);
      expect(createWorker.firstCall.args[0]).to.equal('eng');
      expect(createWorker.firstCall.args[2]).to.include({
        langPath: OCR_DATA_DIR,
        cacheMethod: 'none',
      });
      expect(worker.recognize.calledOnce).to.equal(true);
      expect(worker.terminate.calledOnce).to.equal(true);
    });

    it("Omni-Vision's worker reads the shipped data", async () => {
      const worker = {
        setParameters: sinon.stub().resolves(),
        recognize: sinon.stub().resolves({ data: { text: '', words: [], hocr: '', tsv: '' } }),
        terminate: sinon.stub().resolves(),
      };
      const createWorker = sinon.stub(Tesseract, 'createWorker').resolves(worker as any);
      Container.set(OmniVisionService, new OmniVisionService());
      const driver = {
        getScreenshot: sinon.stub().resolves((await imageOf('Login')).toString('base64')),
      };
      await Container.get(OmniVisionService).findByText(driver, 'Login');

      expect(createWorker.calledOnce).to.equal(true);
      expect(createWorker.firstCall.args[0]).to.equal('eng');
      expect(createWorker.firstCall.args[2]).to.include({
        langPath: OCR_DATA_DIR,
        cacheMethod: 'none',
      });
    });
  });
});
