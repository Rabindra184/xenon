import { ESCAPE_RE } from '@shared/ansi';

// Minimal ANSI SGR parser for the log console: turns escape-coded process
// output into colored segments and strips every other escape and control
// (links, titles, cursor codes, a lone BEL or CR). Only foreground colors are
// honored — that's all Appium/Xenon emit — in their `;` and `:` forms. Every
// color is one of eight theme tokens, never a hex value. Which codes are taken
// out is the shared rule (ESCAPE_RE), the one stripAnsi follows, so the words
// drawn are the words searched, copied, saved and quoted.

export interface AnsiSegment {
  text: string;
  /** CSS color for this segment; absent = inherit the stream default. */
  color?: string;
}

// The 16 base colors (30–37 normal, 90–97 bright) are theme tokens rather than
// hex, so log colors follow light and dark and keep their contrast in both.
// Bright variants share their normal color's token.
const BASIC_TOKENS: Record<number, string> = {
  30: 'var(--text-dim)',
  31: 'var(--red)',
  32: 'var(--green)',
  33: 'var(--amber)',
  34: 'var(--blue)',
  35: 'var(--blue-400)',
  36: 'var(--sky-400)',
  37: 'var(--text)'
};

const BASIC_COLORS: Record<number, string> = Object.fromEntries(
  Object.entries(BASIC_TOKENS).flatMap(([code, token]) => [
    [code, token],
    [Number(code) + 60, token]
  ])
);

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

type Rgb = readonly [number, number, number];

// Fixed colors the extended (256-color and 24-bit) codes are matched against, each standing for the
// theme token it is named for. Every token has a few (its pure, dark and pastel shades), so a light
// green is still "green" and not the nearest white. A hex color wouldn't follow light and dark,
// and Appium and Xenon print most of their colors this way, so every extended color becomes one of
// the eight tokens above.
const DIM = BASIC_TOKENS[30];
const RED = BASIC_TOKENS[31];
const GREEN = BASIC_TOKENS[32];
const AMBER = BASIC_TOKENS[33];
const BLUE = BASIC_TOKENS[34];
const VIOLET = BASIC_TOKENS[35]; // magenta, purple and pink read as blue-400, as code 35 does
const SKY = BASIC_TOKENS[36];
const PLAIN = BASIC_TOKENS[37];

const REFERENCES: ReadonlyArray<readonly [Rgb, string]> = [
  [[0, 0, 0], DIM],
  [[128, 128, 128], DIM],
  [[192, 192, 192], PLAIN],
  [[255, 255, 255], PLAIN],
  [[255, 0, 0], RED],
  [[128, 0, 0], RED],
  [[255, 128, 128], RED],
  [[0, 255, 0], GREEN],
  [[0, 128, 0], GREEN],
  [[128, 255, 128], GREEN],
  [[255, 255, 0], AMBER],
  [[255, 165, 0], AMBER],
  [[128, 128, 0], AMBER],
  [[255, 255, 128], AMBER],
  [[0, 0, 255], BLUE],
  [[0, 0, 128], BLUE],
  [[0, 95, 255], BLUE],
  [[128, 128, 255], BLUE],
  [[255, 0, 255], VIOLET],
  [[128, 0, 128], VIOLET],
  [[255, 128, 255], VIOLET],
  [[0, 255, 255], SKY],
  [[0, 128, 128], SKY],
  [[128, 255, 255], SKY]
];

/** The theme token whose reference color is nearest to this one (squared distance in RGB). */
function nearestToken([r, g, b]: Rgb): string {
  let best = PLAIN;
  let bestDistance = Infinity;
  for (const [[rr, rg, rb], token] of REFERENCES) {
    const d = (r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = token;
    }
  }
  return best;
}

/** xterm-256 palette entry → a theme token: the base token for 0–15, the nearest token for the rest. */
function color256(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 16) return BASIC_COLORS[n < 8 ? 30 + n : 90 + (n - 8)];
  if (n < 232) {
    const i = n - 16;
    return nearestToken([CUBE_LEVELS[Math.floor(i / 36)], CUBE_LEVELS[Math.floor(i / 6) % 6], CUBE_LEVELS[i % 6]]);
  }
  const gray = 8 + (n - 232) * 10;
  return nearestToken([gray, gray, gray]);
}

/** A 24-bit color → the nearest theme token; undefined when a channel is not 0–255. */
function colorRgb(r: number, g: number, b: number): string | undefined {
  for (const c of [r, g, b]) if (!Number.isInteger(c) || c < 0 || c > 255) return undefined;
  return nearestToken([r, g, b]);
}

// Its own copy of the shared pattern: a global pattern keeps its place between exec calls.
const ESCAPES = new RegExp(ESCAPE_RE);

/**
 * A foreground colour in the colon form (ITU T.416): `38:5:n`, `38:2:<colour space>:r:g:b`, or the
 * common `38:2:r:g:b`; its parts as written. Undefined when it is not one.
 */
function colonColor(parts: string[]): string | undefined {
  const mode = Number(parts[1]);
  if (mode === 5) return color256(Number(parts[2]));
  if (mode !== 2) return undefined;
  const [r, g, b] = (parts.length >= 6 ? parts.slice(3, 6) : parts.slice(2, 5)).map(Number);
  return colorRgb(r, g, b);
}

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

  ESCAPES.lastIndex = 0;
  for (let m = ESCAPES.exec(input); m; m = ESCAPES.exec(input)) {
    push(input.slice(last, m.index));
    last = m.index + m[0].length;
    // Anything but a colour code (an OSC, another CSI, a control) is only taken out. A colour code
    // is `m` with no intermediates, and only digits, `;` and `:` (no private marker such as `?`).
    const [, rawParams, intermediates, final] = m;
    if (final !== 'm' || intermediates !== '' || !/^[\d;:]*$/.test(rawParams)) continue;

    const groups = rawParams.length ? rawParams.split(';') : ['0'];
    // A colon group (`38:2::r:g:b`) carries its own numbers; it stands as one code.
    const params = groups.map((g) => (g.includes(':') ? NaN : Number(g)));
    for (let i = 0; i < params.length; i++) {
      if (groups[i].includes(':')) {
        const parts = groups[i].split(':');
        // Only the foreground is shown; a colon background or underline colour, or an underline
        // style (4:3), is dropped and the words kept.
        if (Number(parts[0]) === 38) color = colonColor(parts) ?? color;
        continue;
      }
      const p = params[i];
      if (p === 0 || p === 39) color = undefined;
      else if (BASIC_COLORS[p]) color = BASIC_COLORS[p];
      else if (p === 38 || p === 48 || p === 58) {
        // An extended color: 5;n (256 colors) or 2;r;g;b (24-bit). Its numbers belong to it, not to
        // the codes after it. Only the foreground (38) is shown; the background and underline
        // colors (48, 58) are read past and dropped.
        const mode = params[i + 1];
        if (mode === 5) {
          if (p === 38) color = color256(params[i + 2]) ?? color;
          i += 2;
        } else if (mode === 2) {
          if (p === 38) color = colorRgb(params[i + 2], params[i + 3], params[i + 4]) ?? color;
          i += 4;
        }
      }
      // anything else (bold, underline…) is ignored
    }
  }
  push(input.slice(last));
  return segments;
}
