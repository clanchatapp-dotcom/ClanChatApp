/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        ink: '#050507',
        panel: '#0d0d13',
        panel2: '#14141c',
        edge: '#20212e',
        brand: { DEFAULT: '#6d5efc', 600: '#5b4df0', 700: '#4a3dd6' },
      },
      keyframes: {
        pop: { '0%': { transform: 'translateY(4px) scale(.98)', opacity: '0' }, '100%': { transform: 'translateY(0) scale(1)', opacity: '1' } },
      },
      animation: { pop: 'pop .18s ease-out' },
    },
  },
  plugins: [],
}
