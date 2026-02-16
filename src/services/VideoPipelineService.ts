import { Service, Container } from 'typedi';
import { spawn, ChildProcess } from 'child_process';
import log from '../logger';
import path from 'path';
import os from 'os';
import * as fs from 'fs';
import { config } from '../config';
import { DeviceStoreFactory } from '../data-service/device-store';
import { ResourceIsolationService } from './ResourceIsolationService';

export interface VideoPipelineOptions {
  sessionId: string;
  udid: string;
  resolution?: string;
  bitrate?: string;
  mjpegPort?: number; // Principal Efficiency: Optional pre-resolved port
}

/**
 * Intelligent Video Pipeline Service
 *
 * Objectives:
 * 1. Hardware-accelerated encoding (VideoToolbox on Mac).
 * 2. Zero-copy asset management (direct storage).
 * 3. Instant Playback via fragmented MP4.
 */
@Service()
export class VideoPipelineService {
  private activeRecordings: Map<string, ChildProcess> = new Map();
  private recordingPaths: Map<string, string> = new Map();
  private isMac: boolean;

  constructor() {
    this.isMac = os.platform() === 'darwin';
  }

  /**
   * Start background recording for a session
   */
  public async startRecording(options: VideoPipelineOptions): Promise<void> {
    const { sessionId, udid } = options;

    if (this.activeRecordings.has(sessionId)) {
      log.warn(`[VideoPipeline] Recording already in progress for session ${sessionId}`);
      return;
    }

    // 1. Resolve Device MJPEG Port
    let mjpegPort = options.mjpegPort;
    if (!mjpegPort) {
      const device = await DeviceStoreFactory.getStore().findDevice({ udid });
      if (!device || !device.mjpegServerPort) {
        throw new Error(
          `[VideoPipeline] Cannot find MJPEG port for device ${udid}. Is the stream service running?`,
        );
      }
      mjpegPort = device.mjpegServerPort;
    }

    const mjpegUrl = `http://127.0.0.1:${mjpegPort}`;
    const outputDir = path.join(config.sessionAssetsPath, sessionId, 'video');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, `${sessionId}.mp4`);

    log.info(`[VideoPipeline] Starting HW-accelerated recording for ${sessionId} from ${mjpegUrl}`);

    // Small settlement delay to allow the source stream to prime
    await new Promise(r => setTimeout(r, 500));

    // 2. Construct FFMPEG Args
    // -f mjpeg: Input format
    // -i: Input source
    // -c:v: Hardware accelerated encoder based on platform
    // -movflags: fMP4 for instant playback and crash resiliency
    const args = [
      '-y',
      '-loglevel',
      'error', // Only log errors to keep console clean
      '-reconnect',
      '1',
      '-reconnect_at_eof',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5',
      '-probesize',
      '32', // Fast startup for MJPEG
      '-analyzeduration',
      '0',
      '-f',
      'mjpeg',
      '-i',
      mjpegUrl,
      '-pix_fmt',
      'yuv420p',
    ];

    if (this.isMac) {
      args.push('-c:v', 'h264_videotoolbox');
      args.push('-realtime', '1'); // VideoToolbox optimization
      args.push('-q:v', '50'); // High quality/efficiency balance
    } else {
      args.push('-c:v', 'libx264');
      args.push('-preset', 'veryfast');
      args.push('-crf', '25');
    }

    // Instant Playback Flags (fMP4)
    args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof');
    args.push(outputPath);

    // 3. Wrap with Resource Isolation (Economy)
    const isolationService = Container.get(ResourceIsolationService);
    const { command, args: wrappedArgs } = isolationService.wrapSpawn('ffmpeg', args, 'Economy');

    const ffmpegProc = spawn(command, wrappedArgs, {
      stdio: ['ignore', 'ignore', 'pipe'], // Only capture stderr for errors
    });

    ffmpegProc.stderr?.on('data', (data) => {
      const msg = data.toString();
      if (msg.toLowerCase().includes('error')) {
        log.error(`[VideoPipeline] FFMPEG Error [${sessionId}]: ${msg}`);
      }
    });

    ffmpegProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        log.warn(`[VideoPipeline] FFMPEG for ${sessionId} exited with code ${code}`);
      }
      this.activeRecordings.delete(sessionId);
    });

    this.activeRecordings.set(sessionId, ffmpegProc);
    this.recordingPaths.set(sessionId, outputPath);
  }

  /**
   * Stop recording and return the relative asset path
   */
  public async stopRecording(sessionId: string): Promise<string | null> {
    const proc = this.activeRecordings.get(sessionId);
    const recordedPath = this.recordingPaths.get(sessionId);

    if (!proc) {
      log.info(`[VideoPipeline] No active recording process for ${sessionId}, returning stored path if any.`);
      const relativePath = recordedPath ? path.relative(config.sessionAssetsPath, recordedPath) : null;
      this.recordingPaths.delete(sessionId);
      return relativePath;
    }

    log.info(`[VideoPipeline] Stopping recording for ${sessionId}`);

    return new Promise((resolve) => {
      proc.on('exit', () => {
        const relativePath = path.relative(config.sessionAssetsPath, recordedPath!);
        this.activeRecordings.delete(sessionId);
        this.recordingPaths.delete(sessionId);
        resolve(relativePath);
      });
      proc.kill('SIGINT'); // Graceful termination to ensure header finalization
    });
  }

  public isRecording(sessionId: string): boolean {
    return this.activeRecordings.has(sessionId) || this.recordingPaths.has(sessionId);
  }

  /**
   * Terminate all active recordings (used during system shutdown)
   */
  public async cleanup(): Promise<void> {
    log.info(`[VideoPipeline] Cleaning up ${this.activeRecordings.size} active recordings`);
    for (const [sessionId, proc] of this.activeRecordings.entries()) {
      proc.kill('SIGINT');
    }
    this.activeRecordings.clear();
  }
}
