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
    },
  },
  plugins: [
    // `light:` scopes a utility to the light theme, so a TSX fix for light
    // leaves dark untouched, like the :root[data-theme='light'] overrides in CSS.
    plugin(({ addVariant }) => addVariant('light', ":root[data-theme='light'] &")),
  ],
};
