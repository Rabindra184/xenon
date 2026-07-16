// Minimal ANSI SGR parser for the log console: turns escape-coded process
// output into colored segments and strips every other CSI sequence. Only
// foreground colors are honored — that's all Appium/Xenon emit.

export interface AnsiSegment {
  text: string;
  /** CSS color for this segment; absent = inherit the stream default. */
  color?: string;
}

// Dark-background-friendly take on the 16 base colors (30–37 normal, 90–97 bright).
const BASIC_COLORS: Record<number, string> = {
  30: '#8b949e',
  31: '#e5534b',
  32: '#4ec96f',
  33: '#d4a72c',
  34: '#539bf5',
  35: '#b083f0',
  36: '#39c5cf',
  37: '#d1d5da',
  90: '#6e7681',
  91: '#ff6b6b',
  92: '#6bd47e',
  93: '#e3b341',
  94: '#6cb6ff',
  95: '#dcbdfb',
  96: '#56d4dd',
  97: '#f0f3f6'
};

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function hex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** xterm-256 palette entry → CSS hex color. */
function color256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 16) return BASIC_COLORS[n < 8 ? 30 + n : 90 + (n - 8)];
  if (n < 232) {
    const i = n - 16;
    const r = CUBE_LEVELS[Math.floor(i / 36)];
    const g = CUBE_LEVELS[Math.floor(i / 6) % 6];
    const b = CUBE_LEVELS[i % 6];
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const gray = 8 + (n - 232) * 10;
  return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
}

const CSI_RE = /\x1b\[([0-9;]*)([A-Za-z])/g;

export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let color: string | undefined;
  let last = 0;

  const push = (text: string) => {
    if (!text) return;
    const prev = segments[segments.length - 1];
    if (prev && prev.color === color) prev.text += text;
    else segments.push(color ? { text, color } : { text });
  };

  CSI_RE.lastIndex = 0;
  for (let m = CSI_RE.exec(input); m; m = CSI_RE.exec(input)) {
    push(input.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] !== 'm') continue; // non-SGR sequence: strip it

    const params = m[1].length ? m[1].split(';').map(Number) : [0];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p === 0 || p === 39) color = undefined;
      else if (BASIC_COLORS[p]) color = BASIC_COLORS[p];
      else if (p === 38 && params[i + 1] === 5) {
        color = color256(params[i + 2]) ?? color;
        i += 2;
      }
      // anything else (bold, underline, bg…) is ignored
    }
  }
  push(input.slice(last));
  return segments;
}
