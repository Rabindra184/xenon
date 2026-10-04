import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Tesseract from 'tesseract.js';
import log from '../../logger';

/**
 * The language data every OCR worker reads, shipped with the plugin
 * (vendor/README.md says where it comes from).
 *
 * Left to its defaults, tesseract.js downloads eng.traineddata from
 * cdn.jsdelivr.net when a worker starts, and caches it in the process's working
 * directory. So a server with no internet couldn't run OCR at all, and one with
 * internet left a 5 MB eng.traineddata wherever it was started (the home
 * directory, ~/.appium). Through 2.14 that was every Xenon server.
 */

export const OCR_LANGUAGE = 'eng';
export const OCR_DATA_DIR = path.join(__dirname, 'vendor');
export const OCR_DATA_FILE = path.join(OCR_DATA_DIR, `${OCR_LANGUAGE}.traineddata.gz`);
/** The shipped file's SHA-256, as vendor/README.md gives it. */
export const OCR_DATA_SHA256 = '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91';

/**
 * What a worker is given: read the data from `dataDir` (a directory, never a
 * URL, so nothing is fetched), and cache it nowhere. A job's own failure
 * rejects its promise; without an errorHandler tesseract.js also throws it from
 * the worker's message handler, where nothing can catch it.
 */
export function ocrWorkerOptions(dataDir = OCR_DATA_DIR): Partial<Tesseract.WorkerOptions> {
  return {
    langPath: dataDir,
    cacheMethod: 'none',
    gzip: true,
    errorHandler: (err: unknown) => log.warn(`OCR: ${err}`),
  };
}

/** Files whose data checked out, so each is read and hashed once per process. */
const checked = new Set<string>();

/**
 * The data is the file the plugin ships, whole. tesseract.js 7, given data it
 * can't load, answers a job it has already refused and throws a TypeError from
 * its message handler, which ends the server (src/index.ts exits on an
 * uncaught exception). So a damaged install is refused here, before a worker
 * sees it.
 */
async function checkData(file: string): Promise<void> {
  if (checked.has(file)) return;
  let data: Buffer;
  try {
    data = await fs.promises.readFile(file);
  } catch {
    throw new Error(`OCR can't start: its language data is missing (${file})`);
  }
  if (crypto.createHash('sha256').update(data).digest('hex') !== OCR_DATA_SHA256) {
    throw new Error(`OCR can't start: its language data is damaged (${file})`);
  }
  checked.add(file);
}

/**
 * An OCR worker for English, from the data that ships with the plugin. Fails
 * with the reason when it can't start: a worker whose data won't load never
 * settles otherwise, and OmniVisionService's lock would wait on it for ever.
 */
export async function createOcrWorker(dataDir = OCR_DATA_DIR): Promise<Tesseract.Worker> {
  await checkData(path.join(dataDir, `${OCR_LANGUAGE}.traineddata.gz`));
  let failed!: (err: Error) => void;
  const failure = new Promise<never>((_, reject) => {
    failed = reject;
  });
  const options = ocrWorkerOptions(dataDir);
  const logError = options.errorHandler!;
  const worker = Tesseract.createWorker(OCR_LANGUAGE, Tesseract.OEM.LSTM_ONLY, {
    ...options,
    errorHandler: (err: unknown) => {
      logError(err);
      failed(new Error(`OCR can't start: ${err}`));
    },
  });
  // Once the worker has started, a later job's failure is only logged.
  return Promise.race([worker, failure]);
}
