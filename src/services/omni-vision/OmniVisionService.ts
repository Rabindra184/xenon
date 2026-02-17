import { Service } from 'typedi';
import Tesseract, { PSM } from 'tesseract.js';
import sharp from 'sharp';
import { AI_SERVICE } from '../AIService';
import log from '../../logger';

export interface OmniElement {
  id: string;
  text?: string;
  rect: { x: number; y: number; width: number; height: number };
  confidence: number;
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
}
