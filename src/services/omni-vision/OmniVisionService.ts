import { Service } from 'typedi';
import Tesseract, { PSM } from 'tesseract.js';
import sharp from 'sharp';
import { AI_SERVICE } from '../AIService';
import log from '../../logger';
import crypto from 'crypto';

export interface OmniElement {
  id: string;
  text?: string;
  rect: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface OmniClickRequest {
  text: string;
  index?: number; // 1-based, like common test conventions
  takeANewScreenShot?: boolean;
}

export interface OmniClickResult {
  clicked: boolean;
  message: string;
  target?: {
    text: string;
    index: number;
    x: number;
    y: number;
    rect: { x: number; y: number; width: number; height: number };
    confidence: number;
  };
}

export interface UiLensItem {
  text: string;
  color: string | null;
  position: string;
  aligned: string;
  above: string | null;
  below: string | null;
  icon: string | null;
  icon_color: string | null;
  icon_category: string | null;
}

// Mobile UIs have sparse text on complex backgrounds - reduce contrast to preserve readability
const DEFAULT_CONTRAST = 1.2; // Slightly above 1.0 for mild enhancement (was 0.8 which was too aggressive)
const UPSCALE_THRESHOLD = 800; // Only upscale very small images (was 1500)

@Service()
export class OmniVisionService {
  private logger = log.scope('OmniVision');
  private virtualElementStore = new Map<string, OmniElement>();
  private sharedWorker: Tesseract.Worker | null = null;
  private workerBusy = false;
  private uiLensCache = new Map<string, { hash: string; createdAt: number; items: UiLensItem[] }>();

  private static readonly UI_LENS_CACHE_TTL_MS = 10_000; // 10s TTL to avoid repeated OCR on rapid calls

  private async getWorker(): Promise<Tesseract.Worker> {
    if (this.sharedWorker) return this.sharedWorker;
    this.logger.info('Initializing persistent OCR worker with explicit configuration...');

    const worker = await Tesseract.createWorker('eng');
    // PSM.SPARSE_TEXT is optimized for irregular text layouts like mobile UIs
    // AUTO mode assumes document structure which fails on sparse mobile screens
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    });

    this.sharedWorker = worker;
    this.logger.info(
      'OCR worker initialized successfully with PSM.SPARSE_TEXT (optimized for mobile UI).',
    );
    return this.sharedWorker;
  }

  private parseHocr(hocr: string): any[] {
    if (!hocr) return [];
    const words: any[] = [];
    // Match word spans: support both ocr_word and ocrx_word
    const wordRegex =
      /<span[^>]*class=['"]ocrx?_word['"][^>]*title=['"]bbox (\d+) (\d+) (\d+) (\d+); x_wconf (\d+)['"]>([^<]+)<\/span>/g;
    let match;
    while ((match = wordRegex.exec(hocr)) !== null) {
      words.push({
        text: match[6].trim(),
        confidence: parseInt(match[5]),
        bbox: {
          x0: parseInt(match[1]),
          y0: parseInt(match[2]),
          x1: parseInt(match[3]),
          y1: parseInt(match[4]),
        },
      });
    }
    return words;
  }

  private parseTsv(tsv: string): any[] {
    if (!tsv) return [];
    this.logger.debug(`Raw TSV snippet: ${tsv.substring(0, 200).replace(/\n/g, '\\n')}`);
    const lines = tsv.split(/\r?\n/);
    const words: any[] = [];

    // Header: level page_num block_num par_num line_num word_num left top width height conf text
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length < 12) continue;

      const level = parseInt(cols[0]);
      const conf = parseFloat(cols[10]);
      const text = cols[11]?.trim();

      // Level 5 is "word" in Tesseract TSV
      if (level === 5 && text && conf > 0) {
        words.push({
          text: text,
          confidence: conf,
          bbox: {
            x0: parseInt(cols[6]),
            y0: parseInt(cols[7]),
            x1: parseInt(cols[6]) + parseInt(cols[8]),
            y1: parseInt(cols[7]) + parseInt(cols[9]),
          },
        });
      }
    }
    return words;
  }

  private validateBuffer(buffer: Buffer, context: string) {
    if (!buffer || buffer.length === 0) {
      throw new Error(`[OmniVision] ${context}: Input Buffer is empty.`);
    }
    if (buffer.length < 500) {
      // A valid screenshot is usually > 50KB. 500 bytes is a safe physiological minimum for a tiny image.
      this.logger.warn(
        `[OmniVision] ${context}: Buffer size exceptionally small (${buffer.length} bytes). Possible truncation.`,
      );
    }
  }

  private normalizeWordBBox(
    word: any,
  ): { x0: number; y0: number; x1: number; y1: number; text: string; confidence: number } | null {
    const text = (word?.text || '').trim();
    if (!text) return null;

    const confRaw = word?.confidence;
    const confidence =
      typeof confRaw === 'number' ? confRaw : typeof confRaw === 'string' ? parseFloat(confRaw) : 0;

    const bbox = word?.bbox || word?.boundingBox || word?.box;
    if (bbox && typeof bbox === 'object') {
      const x0 = bbox.x0 ?? bbox.left ?? bbox.x ?? bbox[0];
      const y0 = bbox.y0 ?? bbox.top ?? bbox.y ?? bbox[1];
      const x1 =
        bbox.x1 ??
        bbox.right ??
        (bbox.x0 !== undefined && bbox.width !== undefined ? bbox.x0 + bbox.width : bbox[2]);
      const y1 =
        bbox.y1 ??
        bbox.bottom ??
        (bbox.y0 !== undefined && bbox.height !== undefined ? bbox.y0 + bbox.height : bbox[3]);

      if ([x0, y0, x1, y1].every((v) => typeof v === 'number' && isFinite(v))) {
        return { x0, y0, x1, y1, text, confidence };
      }
    }
    return null;
  }

  private rgbToBasicColorName(r: number, g: number, b: number): string {
    // Very lightweight naming for enterprise stability (no ML dependency)
    // Convert to HSV-ish buckets
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    const v = max / 255;
    const s = max === 0 ? 0 : delta / max;

    // Grayscale
    if (s < 0.15) {
      if (v > 0.85) return 'white';
      if (v < 0.2) return 'black';
      return 'gray';
    }

    let h = 0;
    if (delta === 0) h = 0;
    else if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;

    if (h < 15 || h >= 345) return 'red';
    if (h < 45) return 'orange';
    if (h < 70) return 'yellow';
    if (h < 170) return 'green';
    if (h < 200) return 'cyan';
    if (h < 255) return 'blue';
    if (h < 290) return 'purple';
    if (h < 345) return 'pink';
    return 'unknown';
  }

  private async sampleAverageColorName(
    image: sharp.Sharp,
    bbox: { x0: number; y0: number; x1: number; y1: number },
    imageW: number,
    imageH: number,
  ): Promise<string | null> {
    const left = Math.max(0, Math.min(imageW - 1, Math.floor(bbox.x0)));
    const top = Math.max(0, Math.min(imageH - 1, Math.floor(bbox.y0)));
    const right = Math.max(0, Math.min(imageW, Math.ceil(bbox.x1)));
    const bottom = Math.max(0, Math.min(imageH, Math.ceil(bbox.y1)));

    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);

    // Sample a small, stable grid to reduce cost
    const targetW = 8;
    const targetH = 8;

    try {
      const raw = await image
        .clone()
        .extract({ left, top, width, height })
        .resize(targetW, targetH, { fit: 'fill' })
        .raw()
        .toBuffer();

      // raw is RGB (or RGBA) depending on input; ensure 3 channels
      const channels = raw.length === targetW * targetH * 4 ? 4 : 3;
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < raw.length; i += channels) {
        r += raw[i];
        g += raw[i + 1];
        b += raw[i + 2];
      }
      const n = raw.length / channels;
      return this.rgbToBasicColorName(r / n, g / n, b / n);
    } catch (e) {
      return null;
    }
  }

  private async preprocessImage(buffer: Buffer): Promise<Buffer> {
    try {
      this.validateBuffer(buffer, 'Pre-processing');
      let sharpImage = sharp(buffer);

      // Convert to grayscale and apply mild contrast to enhance text visibility
      // Using DEFAULT_CONTRAST of 1.2 for mild enhancement without washing out text
      sharpImage = sharpImage.greyscale().linear(DEFAULT_CONTRAST, -(128 * DEFAULT_CONTRAST) + 128);

      // Sharpen edges to define text against complex backgrounds
      sharpImage = sharpImage.sharpen();

      // NOTE: Upscaling removed to ensure bounding box coordinates match original image
      // The PSM.SPARSE_TEXT mode is optimized for mobile UIs and doesn't require upscaling

      const processedBuffer = await sharpImage.toBuffer();
      this.logger.debug(
        'Image pre-processed: grayscale + contrast + sharpen applied (no upscaling).',
      );
      return processedBuffer;
    } catch (e: any) {
      this.logger.warn(`Image pre-processing skipped: ${e.message}. Using original buffer.`);
      return buffer;
    }
  }

  private async performOcr(buffer: Buffer): Promise<{ text: string; words: any[] }> {
    this.validateBuffer(buffer, 'OCR Engine');

    // Simple lock to avoid concurrent worker use in this context
    while (this.workerBusy) await new Promise((r) => setTimeout(r, 100));
    this.workerBusy = true;

    try {
      // Pre-process image for better OCR accuracy
      const processedBuffer = await this.preprocessImage(buffer);
      this.validateBuffer(processedBuffer, 'OCR Post-processing');

      const worker = await this.getWorker();
      // CRITICAL: Tesseract.js v6+ disables all outputs except 'text' by default
      // We must explicitly enable hocr, tsv, and blocks for spatial data
      const result = await worker.recognize(
        processedBuffer,
        {},
        {
          hocr: true,
          tsv: true,
          blocks: true,
          text: true,
        },
      );
      const data = result.data as any;

      // Debug: Log what Tesseract v7 actually returns
      this.logger.debug(`Tesseract result keys: ${Object.keys(result).join(', ')}`);
      this.logger.debug(`Tesseract result.data keys: ${Object.keys(result.data).join(', ')}`);

      let words = data.words || [];

      if (words.length === 0) {
        const blocks = data.blocks || data.layoutBlocks || [];
        if (blocks.length > 0) {
          this.logger.debug(`Extracting words from ${blocks.length} blocks...`);
          // DIAGNOSTIC: Log actual block structure
          blocks.forEach((block: any, i: number) => {
            this.logger.debug(`Block[${i}] keys: ${Object.keys(block).join(', ')}`);
            const paras = block.paragraphs || [];
            this.logger.debug(`Block[${i}] has ${paras.length} paragraphs`);
            if (paras.length > 0) {
              this.logger.debug(
                `Block[${i}].paragraphs[0] keys: ${Object.keys(paras[0]).join(', ')}`,
              );
            }
            paras.forEach((para: any) => {
              (para.lines || []).forEach((line: any) => {
                (line.words || []).forEach((word: any) => words.push(word));
              });
            });
          });

          // If block extraction still yielded nothing, try direct 'words' property on block
          if (words.length === 0) {
            blocks.forEach((block: any) => {
              if (block.words && Array.isArray(block.words)) {
                words.push(...block.words);
              }
            });
          }
        }
      }

      // ALWAYS attempt HOCR parsing - it's more reliable than block.paragraphs
      if (data.hocr) {
        this.logger.info(
          `HOCR parsing. Block extraction yielded ${words.length} words. HOCR length: ${data.hocr.length} chars`,
        );
        const hocrWords = this.parseHocr(data.hocr);
        if (hocrWords.length > words.length) {
          this.logger.info(
            `✓ HOCR yielded ${hocrWords.length} words (better than block extraction's ${words.length}). Using HOCR.`,
          );
          words = hocrWords;
        } else if (hocrWords.length > 0) {
          this.logger.debug(
            `HOCR yielded ${hocrWords.length} words. Block extraction: ${words.length}. Keeping blocks.`,
          );
        } else {
          this.logger.warn(
            `HOCR parsing returned 0 words despite ${data.hocr.length} chars of data.`,
          );
          // Log a snippet of HOCR for debugging
          this.logger.debug(
            `Raw HOCR snippet: ${data.hocr.substring(0, 500).replace(/\n/g, '\\n')}`,
          );
        }
      } else {
        this.logger.warn('HOCR data not available from Tesseract.');
      }

      // Fallback Level 3: TSV Parsing
      if (words.length === 0 && data.tsv) {
        this.logger.info(`TSV fallback triggered. TSV length: ${data.tsv.length} chars`);
        const tsvWords = this.parseTsv(data.tsv);
        if (tsvWords.length > 0) {
          this.logger.info(`✓ Recovered ${tsvWords.length} words from TSV metadata.`);
          words = tsvWords;
        } else {
          this.logger.warn(
            `TSV parsing returned 0 words despite ${data.tsv.length} chars of data.`,
          );
        }
      } else if (words.length === 0) {
        this.logger.warn(`TSV fallback skipped. data.tsv exists: ${!!data.tsv}`);
      }

      this.logger.debug(`Final word count: ${words.length}`);
      if (words.length === 0 && data.text) {
        this.logger.warn(
          `Spatial Blindness: Found text but 0 bounding boxes. Text snippet: "${data.text.substring(0, 50)}..."`,
        );
      }

      return {
        text: data.text || '',
        words: words,
      };
    } catch (e: any) {
      this.logger.error(`OCR Operation failed: ${e.message}`);
      // Reset worker on critical failure
      if (this.sharedWorker) {
        await this.sharedWorker.terminate();
        this.sharedWorker = null;
      }
      throw e;
    } finally {
      this.workerBusy = false;
    }
  }

  /**
   * Proactive OCR Search: Finds elements matching text even if not in XML
   */
  async findByText(driver: any, text: string): Promise<OmniElement[]> {
    this.logger.info(`Searching for text: "${text}" via proactive OCR...`);
    try {
      const screenshot = await driver.getScreenshot();
      const buffer = Buffer.from(screenshot, 'base64');
      const { text: ocrText, words } = await this.performOcr(buffer);

      if (words.length === 0) {
        this.logger.warn(
          `OCR proactive search yielded no words. Text content: "${ocrText.trim().substring(0, 100)}..."`,
        );
        return [];
      }

      const matches = words.filter(
        (w: any) =>
          w.text && w.text.toLowerCase().includes(text.toLowerCase()) && w.confidence > 60,
      );

      return matches.map((m: any) => {
        const el = {
          id: `omni_ocr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          text: m.text,
          rect: {
            x: m.bbox.x0,
            y: m.bbox.y0,
            width: m.bbox.x1 - m.bbox.x0,
            height: m.bbox.y1 - m.bbox.y0,
          },
          confidence: m.confidence / 100,
        };
        this.virtualElementStore.set(el.id, el);
        return el;
      });
    } catch (err: any) {
      this.logger.error(`OCR proactive search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * AI-based visual find for icons or specific descriptions
   */
  async findByIcon(driver: any, iconDescription: string): Promise<OmniElement | null> {
    this.logger.info(`Searching for: "${iconDescription}" via AI Vision...`);
    try {
      const screenshot = await driver.getScreenshot();
      const coordinates = await AI_SERVICE.visualFind(screenshot, iconDescription);

      if (coordinates) {
        const el = {
          id: `omni_ai_${Date.now()}`,
          rect: {
            x: coordinates.x - 20,
            y: coordinates.y - 20,
            width: 40,
            height: 40,
          },
          confidence: 0.85,
        };
        this.virtualElementStore.set(el.id, el);
        return el;
      }
    } catch (err: any) {
      this.logger.error(`AI proactive find failed: ${err.message}`);
    }
    return null;
  }

  /**
   * Extract comprehensive screen metadata
   */
  async analyzeScreen(driver: any): Promise<any> {
    this.logger.info('Performing full screen analysis...');
    try {
      const screenshot = await driver.getScreenshot();
      if (!screenshot || screenshot.trim() === '') {
        throw new Error('Screenshot capture returned empty data.');
      }
      const buffer = Buffer.from(screenshot, 'base64');
      this.validateBuffer(buffer, 'Screen Analysis');

      // 1. Get all text via OCR using the robust worker flow
      const { text: ocrText, words } = await this.performOcr(buffer);

      // 2. Ask AI for qualitative analysis (Non-blocking)
      let aiAnalysis = null;
      try {
        aiAnalysis = await AI_SERVICE.analyzeFailure({
          sessionId: driver.sessionId,
          failureReason: 'Screen Analysis Request',
          commandLogs: [],
          deviceLogs: [],
          screenshotPath: screenshot, // In a real scenario, we'd save this to a file first or pass base64
        });
      } catch (aiErr: any) {
        this.logger.warn(`AI insights skipped: ${aiErr.message}`);
      }

      return {
        timestamp: new Date().toISOString(),
        ocr: {
          text: ocrText,
          words: words.map((w: any) => ({
            text: w.text || '',
            confidence: w.confidence || 0,
            bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
          })),
        },
        ai_insights: aiAnalysis,
      };
    } catch (err: any) {
      this.logger.error(`Screen analysis failed: ${err.message}`);
      return { status: 'error', message: err.message };
    }
  }

  addVirtualElement(element: OmniElement) {
    this.virtualElementStore.set(element.id, element);
  }

  getVirtualElement(id: string): OmniElement | undefined {
    return this.virtualElementStore.get(id);
  }

  /**
   * Omni-Click: Find a target by OCR text and click its center using W3C actions.
   */
  async omniClickByText(driver: any, req: OmniClickRequest): Promise<OmniClickResult> {
    const text = (req.text || '').trim();
    const index = typeof req.index === 'number' ? req.index : 1;
    const takeANewScreenShot = req.takeANewScreenShot !== false;

    if (!text) return { clicked: false, message: 'Text is empty' };
    if (!Number.isFinite(index) || index < 1) {
      return { clicked: false, message: 'index must be >= 1' };
    }
    if (typeof driver?.performActions !== 'function') {
      return {
        clicked: false,
        message: 'Driver does not support performActions (W3C actions required for omniClick)',
      };
    }

    this.logger.info(`Omni-Click: searching for text "${text}" (index=${index})...`);

    // OCR scan
    const screenshot = await driver.getScreenshot();
    const buffer = Buffer.from(screenshot, 'base64');
    const { words } = await this.performOcr(buffer);
    const normalized = words.map((w: any) => this.normalizeWordBBox(w)).filter(Boolean) as Array<{
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      text: string;
      confidence: number;
    }>;

    const matches = normalized
      .filter((w) => w.text.toLowerCase().includes(text.toLowerCase()))
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || a.y0 - b.y0 || a.x0 - b.x0);

    if (matches.length === 0) {
      return { clicked: false, message: `No OCR match found for text "${text}"` };
    }

    const pick = matches[Math.min(index - 1, matches.length - 1)];
    const rect = {
      x: Math.max(0, Math.round(pick.x0)),
      y: Math.max(0, Math.round(pick.y0)),
      width: Math.max(1, Math.round(pick.x1 - pick.x0)),
      height: Math.max(1, Math.round(pick.y1 - pick.y0)),
    };
    const cx = Math.round(rect.x + rect.width / 2);
    const cy = Math.round(rect.y + rect.height / 2);

    // Click via touch actions
    await driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: cx, y: cy },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 120 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
    if (typeof driver.releaseActions === 'function') {
      // best-effort
      await driver.releaseActions().catch(() => {});
    }

    return {
      clicked: true,
      message: `Clicked OCR match for "${text}"`,
      target: {
        text: pick.text,
        index,
        x: cx,
        y: cy,
        rect,
        confidence: Math.max(0, Math.min(1, (pick.confidence || 0) / 100)),
      },
    };
  }

  /**
   * Omni-Click by Icon: Find a target by visual description and click its center.
   */
  async omniClickByIcon(
    driver: any,
    req: { icon: string; takeANewScreenShot?: boolean },
  ): Promise<OmniClickResult> {
    const icon = (req.icon || '').trim();
    if (!icon) return { clicked: false, message: 'Icon description is empty' };

    if (typeof driver?.performActions !== 'function') {
      return {
        clicked: false,
        message: 'Driver does not support performActions',
      };
    }

    this.logger.info(`Omni-Click: searching for icon "${icon}" via AI...`);
    const element = await this.findByIcon(driver, icon);

    if (!element) {
      return { clicked: false, message: `No visual match found for icon "${icon}"` };
    }

    const cx = Math.round(element.rect.x + element.rect.width / 2);
    const cy = Math.round(element.rect.y + element.rect.height / 2);

    await driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: cx, y: cy },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 120 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);

    return {
      clicked: true,
      message: `Clicked visual match for "${icon}"`,
      target: {
        text: icon,
        index: 1,
        x: cx,
        y: cy,
        rect: element.rect,
        confidence: element.confidence,
      },
    };
  }

  /**
   * UI Lens Export: OCR + lightweight visual metadata similar to "UI lens" tools.
   */
  async exportUiLensMetadata(
    driver: any,
    options?: { takeANewScreenShot?: boolean; maxItems?: number },
  ): Promise<UiLensItem[]> {
    const takeANewScreenShot = options?.takeANewScreenShot !== false;
    const maxItems = typeof options?.maxItems === 'number' ? options!.maxItems : 200;

    const screenshot = await driver.getScreenshot();
    const hash = crypto.createHash('sha1').update(screenshot).digest('hex');
    const cacheKey = String(driver?.sessionId || 'unknown');
    const cached = this.uiLensCache.get(cacheKey);
    if (
      cached &&
      cached.hash === hash &&
      Date.now() - cached.createdAt < OmniVisionService.UI_LENS_CACHE_TTL_MS
    ) {
      return cached.items;
    }

    const buffer = Buffer.from(screenshot, 'base64');
    const baseImage = sharp(buffer);
    const meta = await baseImage.metadata();
    const imageW = meta.width || 0;
    const imageH = meta.height || 0;

    const { words } = await this.performOcr(buffer);
    const normalized = words.map((w: any) => this.normalizeWordBBox(w)).filter(Boolean) as Array<{
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      text: string;
      confidence: number;
    }>;

    // Reduce noise: keep higher-confidence words first
    const sliced = normalized
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, Math.max(1, Math.min(1000, maxItems)));

    // Precompute centers
    const nodes = sliced.map((w) => {
      const cx = (w.x0 + w.x1) / 2;
      const cy = (w.y0 + w.y1) / 2;
      return { ...w, cx, cy };
    });

    const toPosition = (cx: number, cy: number) => {
      const horiz = imageW
        ? cx < imageW / 3
          ? 'left'
          : cx < (2 * imageW) / 3
            ? 'center'
            : 'right'
        : 'center';
      const vert = imageH
        ? cy < imageH / 3
          ? 'top'
          : cy < (2 * imageH) / 3
            ? 'middle'
            : 'bottom'
        : 'middle';
      return `${vert} ${horiz}`;
    };

    // Alignment: simplistic row grouping by y tolerance
    const yTol = 10;
    const alignedRow = (cy: number) => {
      const inSameRow = nodes.filter((n) => Math.abs(n.cy - cy) <= yTol);
      return inSameRow.length >= 2 ? 'aligned' : 'not aligned';
    };

    // Above/Below: nearest vertically overlapping candidate
    const findNeighbor = (node: any, dir: 'above' | 'below'): string | null => {
      const candidates = nodes
        .filter((n) => {
          if (dir === 'above' && n.cy >= node.cy) return false;
          if (dir === 'below' && n.cy <= node.cy) return false;
          const overlapX = Math.min(n.x1, node.x1) - Math.max(n.x0, node.x0);
          return overlapX > 0;
        })
        .sort((a, b) => Math.abs(a.cy - node.cy) - Math.abs(b.cy - node.cy));
      return candidates[0]?.text || null;
    };

    const items: UiLensItem[] = [];
    for (const n of nodes) {
      const color =
        imageW && imageH ? await this.sampleAverageColorName(baseImage, n, imageW, imageH) : null;
      items.push({
        text: n.text,
        color,
        position: toPosition(n.cx, n.cy),
        aligned: alignedRow(n.cy),
        above: findNeighbor(n, 'above'),
        below: findNeighbor(n, 'below'),
        icon: null,
        icon_color: null,
        icon_category: null,
      });
    }

    this.uiLensCache.set(cacheKey, { hash, createdAt: Date.now(), items });
    return items;
  }
}
