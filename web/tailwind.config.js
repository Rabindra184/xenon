import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      // The type roles from src/tokens.css. xs, sm and base keep Tailwind's own
      // sizes (12/16, 14/20, 16/24), now read from the role they already are.
      fontSize: {
        display: ['var(--type-display-size)', { lineHeight: 'var(--type-display-line)' }],
        title: ['var(--type-title-size)', { lineHeight: 'var(--type-title-line)' }],
        heading: ['var(--type-heading-size)', { lineHeight: 'var(--type-heading-line)' }],
        body: ['var(--type-body-size)', { lineHeight: 'var(--type-body-line)' }],
        label: ['var(--type-label-size)', { lineHeight: 'var(--type-label-line)' }],
        caption: ['var(--type-caption-size)', { lineHeight: 'var(--type-caption-line)' }],
        'mono-data': ['var(--type-mono-size)', { lineHeight: 'var(--type-mono-line)' }],
        xs: ['var(--type-caption-size)', { lineHeight: 'var(--type-caption-line)' }],
        sm: ['var(--type-body-size)', { lineHeight: 'var(--type-body-line)' }],
        base: ['var(--type-heading-size)', { lineHeight: 'var(--type-heading-line)' }],
      },
      // The radii and elevation levels from src/tokens.css. rounded, -md, -lg
      // and -xl keep Tailwind's own pixels (4, 6, 8, 12), now read from the
      // tokens; rounded-sm stays Tailwind's 2px.
      borderRadius: {
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        flat: 'var(--elevation-flat)',
        raised: 'var(--elevation-raised)',
        overlay: 'var(--elevation-overlay)',
        modal: 'var(--elevation-modal)',
      },
    },
  },
  plugins: [
    // `light:` scopes a utility to the light theme, so a TSX fix for light
    // leaves dark untouched, like the :root[data-theme='light'] overrides in CSS.
    plugin(({ addVariant }) => addVariant('light', ":root[data-theme='light'] &")),
  ],
};
