import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import sharp from 'sharp';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';

// Encoder follow-up: the capture loop used to spawn a fresh ffmpeg process per
// frame. This replaces the RGBA path with in-process sharp encoding, keeping the
// raw-pixels-in / JPEG-buffer-out contract. rgb565 keeps the ffmpeg fallback.
// See docs/superpowers/specs/2026-07-23-android-stream-encoder-design.md.

function makeService() {
  // Instantiate without the constructor (which starts a watchdog interval).
  return Object.create(AndroidStreamService.prototype) as any;
}

// A tightly packed solid-colour RGBA buffer of w*h*4 bytes.
function rgbaBuffer(w: number, h: number): Buffer {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 40; // R
    buf[i + 1] = 120; // G
    buf[i + 2] = 200; // B
    buf[i + 3] = 255; // A (opaque)
  }
  return buf;
}

const JPEG_SOI = 0xffd8;
const JPEG_EOI = 0xffd9;

describe('AndroidStreamService sharp encoder', () => {
  const svc = makeService();

  it('encodes RGBA to a valid JPEG, preserving dimensions when no downscale', async () => {
    const w = 240;
    const h = 160;
    const out: Buffer = await svc.encodeRgbaWithSharp(rgbaBuffer(w, h), w, h, /*targetW*/ w);

    expect(out.readUInt16BE(0), 'JPEG SOI marker').to.equal(JPEG_SOI);
    expect(out.readUInt16BE(out.length - 2), 'JPEG EOI marker').to.equal(JPEG_EOI);
    const meta = await sharp(out).metadata();
    expect(meta.format).to.equal('jpeg');
    expect(meta.width).to.equal(240);
    expect(meta.height).to.equal(160);
  });

  it('downscales to the target width, preserving aspect ratio', async () => {
    const w = 960;
    const h = 540;
    const out: Buffer = await svc.encodeRgbaWithSharp(rgbaBuffer(w, h), w, h, /*targetW*/ 720);
    const meta = await sharp(out).metadata();
    expect(meta.width).to.equal(720);
    expect(meta.height).to.equal(405); // 540 * 720/960
  });
});

describe('AndroidStreamService encodeFrame routing', () => {
  afterEach(() => sinon.restore());

  it('routes RGBA frames to the sharp encoder', async () => {
    const svc = makeService();
    const sharpStub = sinon.stub(svc, 'encodeRgbaWithSharp').resolves(Buffer.from([0xff, 0xd8]));
    const ffmpegStub = sinon
      .stub(svc, 'convertRawToJpegFfmpeg')
      .resolves(Buffer.from([0xff, 0xd8]));

    await svc.encodeFrame(Buffer.alloc(16), 2, 2, 2, 2, 'rgba', 'udid-1');

    expect(sharpStub.calledOnce, 'sharp encoder used for rgba').to.be.true;
    expect(ffmpegStub.called, 'ffmpeg not used for rgba').to.be.false;
  });

  it('routes rgb565 frames to the ffmpeg fallback', async () => {
    const svc = makeService();
    const sharpStub = sinon.stub(svc, 'encodeRgbaWithSharp').resolves(Buffer.from([0xff, 0xd8]));
    const ffmpegStub = sinon
      .stub(svc, 'convertRawToJpegFfmpeg')
      .resolves(Buffer.from([0xff, 0xd8]));

    await svc.encodeFrame(Buffer.alloc(16), 2, 2, 2, 2, 'rgb565', 'udid-1');

    expect(ffmpegStub.calledOnce, 'ffmpeg fallback used for rgb565').to.be.true;
    expect(sharpStub.called, 'sharp not used for rgb565').to.be.false;
  });
});
