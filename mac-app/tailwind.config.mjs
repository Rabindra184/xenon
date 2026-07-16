/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Semantic names mapped onto the Xenon design tokens (tokens.css).
      // Components use only these — no raw palette classes.
      colors: {
        app: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        surface2: 'rgb(var(--surface-2-rgb) / <alpha-value>)',
        line: {
          DEFAULT: 'rgb(var(--border-rgb) / <alpha-value>)',
          strong: 'rgb(var(--border-strong-rgb) / <alpha-value>)'
        },
        ink: 'rgb(var(--text-rgb) / <alpha-value>)',
        muted: 'rgb(var(--text-muted-rgb) / <alpha-value>)',
        dim: 'rgb(var(--text-dim-rgb) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--green-rgb) / <alpha-value>)',
          dim: 'rgb(var(--green-dim-rgb) / <alpha-value>)',
          fg: '#052e14'
        },
        warn: 'rgb(var(--amber-rgb) / <alpha-value>)',
        danger: 'rgb(var(--red-rgb) / <alpha-value>)',
        info: 'rgb(var(--blue-rgb) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};
