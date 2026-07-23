import React, { useEffect, useRef } from 'react';

interface WsH264PlayerProps {
  /** ws(s):// URL including the single-use ?ticket=. */
  wsUrl: string;
  /** Called on any fatal condition so the tile can fall back to the MJPEG <img>. */
  onFatal?: () => void;
  className?: string;
}

/**
 * Derive the WebCodecs codec string (`avc1.PPCCLL`) from the Annex-B SPS in a
 * config frame (SPS NAL type 7: the 3 bytes after the NAL header are
 * profile_idc, constraint flags, level_idc).
 */
function codecFromConfig(data: Uint8Array): string {
  for (let i = 0; i + 4 < data.length; i++) {
    const sc4 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1;
    const sc3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    if (!sc4 && !sc3) continue;
    const hdr = i + (sc4 ? 4 : 3);
    if ((data[hdr] & 0x1f) === 7) {
      const hex = (n: number) => n.toString(16).padStart(2, '0');
      return `avc1.${hex(data[hdr + 1])}${hex(data[hdr + 2])}${hex(data[hdr + 3])}`;
    }
  }
  return 'avc1.42e01e'; // baseline fallback
}

/**
 * Decodes the authenticated H.264 WebSocket stream (see `h264StreamWs.ts` wire
 * format) with WebCodecs and paints it to a `<canvas>`. Falls back via `onFatal`
 * when WebCodecs is missing, the decoder errors, or the socket closes before the
 * first config frame. SPS/PPS reach the decoder inside each keyframe (Annex-B),
 * so only the codec string is needed to configure.
 */
const WsH264Player: React.FC<WsH264PlayerProps> = ({ wsUrl, onFatal, className }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const canvas = canvasRef.current;
    if (typeof w.VideoDecoder === 'undefined' || !canvas) {
      fatalRef.current?.();
      return;
    }
    const ctx = canvas.getContext('2d');
    let closed = false;
    let configured = false;
    let timestamp = 0; // client-side monotonic; survives server auto-restarts

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoder = new w.VideoDecoder({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      output: (frame: any) => {
        if (closed) {
          frame.close();
          return;
        }
        if (canvas.width !== frame.displayWidth) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx?.drawImage(frame, 0, 0);
        frame.close();
      },
      error: () => fatalRef.current?.(),
    });

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    ws.onerror = () => fatalRef.current?.();
    ws.onclose = () => {
      if (!configured) fatalRef.current?.();
    };
    ws.onmessage = (ev) => {
      const buf = ev.data as ArrayBuffer;
      const type = new DataView(buf).getUint8(0); // 0 config, 1 key, 2 delta
      const data = new Uint8Array(buf, 9);
      if (type === 0) {
        try {
          decoder.configure({ codec: codecFromConfig(data), optimizeForLatency: true });
          configured = true;
        } catch {
          fatalRef.current?.();
        }
        return;
      }
      if (!configured || decoder.state !== 'configured') return;
      try {
        decoder.decode(
          new w.EncodedVideoChunk({ type: type === 1 ? 'key' : 'delta', timestamp, data }),
        );
        timestamp += 11111; // ~90 fps; decoder only needs strictly increasing values
      } catch {
        /* skip a bad frame; the next keyframe re-syncs */
      }
    };

    return () => {
      closed = true;
      try {
        ws.close();
      } catch {
        /* noop */
      }
      try {
        if (decoder.state !== 'closed') decoder.close();
      } catch {
        /* noop */
      }
    };
  }, [wsUrl]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
    />
  );
};

export default WsH264Player;
