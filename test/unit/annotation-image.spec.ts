import { expect } from 'chai';
import {
  annotationImagePath,
  decodeAnnotationImage,
  MAX_ANNOTATION_PNG_BYTES,
} from '../../src/services/recording/annotationImage';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const dataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;

describe('annotationImage', () => {
  it('puts the image beside the video directory so recording cleanup removes it', () => {
    expect(annotationImagePath('/r/rec-1/video/rec-1.mp4', 'ann-9')).to.equal(
      '/r/rec-1/annotations/ann-9.png',
    );
  });

  it('returns null when no image was sent (API clients, legacy callers)', () => {
    expect(decodeAnnotationImage(undefined)).to.equal(null);
    expect(decodeAnnotationImage(null)).to.equal(null);
  });

  it('decodes a PNG data URL', () => {
    const png = Buffer.concat([PNG_SIG, Buffer.from('rest')]);
    expect(decodeAnnotationImage(dataUrl(png))).to.deep.equal({ ok: true, png });
  });

  it('rejects a non-PNG prefix, a bad signature, an oversize image, and a non-string', () => {
    expect((decodeAnnotationImage('data:image/jpeg;base64,AAAA') as any).ok).to.equal(false);
    expect((decodeAnnotationImage(dataUrl(Buffer.from('notapng!'))) as any).ok).to.equal(false);
    const big = Buffer.concat([PNG_SIG, Buffer.alloc(MAX_ANNOTATION_PNG_BYTES)]);
    expect((decodeAnnotationImage(dataUrl(big)) as any).ok).to.equal(false);
    expect((decodeAnnotationImage(42) as any).ok).to.equal(false);
  });
});
