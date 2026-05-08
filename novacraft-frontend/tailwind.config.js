/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#0A0B1A',
        surface: '#14152A',
        pink:    '#FF2A6D',
        blue:    '#05D9E8',
        muted:   '#3D3F5C',
        text:    '#E8E9F3',
        subtle:  '#7B7D9D',
      },
      fontFamily: {
        heading: ['Syne', 'sans-serif'],
        body:    ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      animation: {
        'glow-pulse': 'glowPulse 3s ease-in-out infinite',
        'float':      'float 6s ease-in-out infinite',
        'fade-up':    'fadeUp 0.5s ease forwards',
      },
      keyframes: {
        glowPulse: {
          '0%,100%': { boxShadow: '0 0 20px #FF2A6D44' },
          '50%':     { boxShadow: '0 0 40px #FF2A6D88' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%':     { transform: 'translateY(-10px)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
