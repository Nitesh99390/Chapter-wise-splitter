/** @type {import('tailwindcss').Config} */
module.exports = {
  // dark mode follows <html data-theme="dark"> (set by the inline script in index.html)
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './js/app.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Noto Sans"', '"Noto Sans Devanagari"', 'sans-serif'],
        serif: ['Charter', '"Iowan Old Style"', 'Georgia', '"Noto Serif"', '"Noto Serif Devanagari"', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(24 24 27 / 0.04)',
        card: '0 1px 2px 0 rgb(24 24 27 / 0.04), 0 1px 3px 0 rgb(24 24 27 / 0.03)',
        pop: '0 4px 6px -2px rgb(24 24 27 / 0.05), 0 12px 24px -4px rgb(24 24 27 / 0.10)'
      },
      fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] }
    }
  },
  plugins: []
};
