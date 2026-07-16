/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Semantic names mapped onto the Xenon design tokens (tokens.css).
      // Components use only these — no raw palette classes.
      colors: {
        app: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        line: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        ink: 'var(--text)',
        muted: 'var(--text-muted)',
        dim: 'var(--text-dim)',
        accent: { DEFAULT: 'var(--green)', dim: 'var(--green-dim)', fg: '#052e14' },
        warn: 'var(--amber)',
        danger: 'var(--red)',
        info: 'var(--blue)'
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};
