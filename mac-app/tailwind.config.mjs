/** A colour from a token's -rgb channels, so opacity modifiers work (bg-accent/10). */
const channels = (token) => `rgb(var(--${token}-rgb) / <alpha-value>)`;

/** One status colour set; the status tokens are already complete colours, so no alpha modifier. */
const status = (name) => ({
  fg: `var(--status-${name}-fg)`,
  bg: `var(--status-${name}-bg)`,
  border: `var(--status-${name}-border)`
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    // Replaced, not extended: the dashboard's scales are the only ones, so a
    // stray `text-3xl` or `rounded-2xl` fails to generate instead of drifting.
    fontSize: {
      '2xs': 'var(--font-size-2xs)',
      xs: 'var(--font-size-xs)',
      sm: 'var(--font-size-sm)',
      md: 'var(--font-size-md)',
      lg: 'var(--font-size-lg)',
      xl: 'var(--font-size-xl)',
      '2xl': 'var(--font-size-2xl)'
    },
    borderRadius: {
      none: '0',
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      DEFAULT: 'var(--radius-md)',
      full: '9999px'
    },
    extend: {
      // Semantic names mapped onto the Xenon design tokens (tokens.css), which
      // follow the theme. Components use only these: no raw palette classes.
      colors: {
        app: channels('bg'),
        surface: channels('surface'),
        surface2: channels('surface-2'),
        sunken: channels('surface-sunken'),
        line: {
          DEFAULT: channels('border'),
          strong: channels('border-strong')
        },
        ink: channels('text'),
        muted: channels('text-muted'),
        dim: channels('text-dim'),
        accent: {
          DEFAULT: channels('color-accent'),
          dim: channels('green-dim'),
          fg: channels('color-on-accent')
        },
        ok: channels('color-success'),
        warn: channels('color-warning'),
        danger: channels('color-danger'),
        info: channels('color-info'),
        focus: channels('color-focus-ring'),
        status: {
          ready: status('ready'),
          busy: status('busy'),
          reserved: status('reserved'),
          error: status('error'),
          offline: status('offline')
        }
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)'
      },
      // The dashboard's 4px grid. Same sizes as Tailwind's own 1-6, 8 and 12.
      spacing: Object.fromEntries([1, 2, 3, 4, 5, 6, 8, 12].map((n) => [n, `var(--space-${n})`])),
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};
