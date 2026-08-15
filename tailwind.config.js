/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Roboto Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        terminal: {
          bg: '#090D14',
          surface: '#0E1420',
          panel: '#131B2A',
          hover: '#192337',
          border: '#1E293B',
          borderLight: '#334155',
          text: '#F1F5F9',
          muted: '#94A3B8',
          dim: '#64748B',
        },
        risk: {
          high: '#EF4444',
          medium: '#F59E0B',
          low: '#10B981',
        },
        accent: {
          cyan: '#06B6D4',
          blue: '#3B82F6',
          amber: '#F59E0B',
          emerald: '#10B981',
          rose: '#F43F5E',
          purple: '#A855F7',
        }
      },
      keyframes: {
        'highlight-flash': {
          '0%': { backgroundColor: 'rgba(59, 130, 246, 0.35)', outline: '1px solid rgba(59, 130, 246, 0.8)' },
          '50%': { backgroundColor: 'rgba(59, 130, 246, 0.18)', outline: '1px solid rgba(59, 130, 246, 0.4)' },
          '100%': { backgroundColor: 'transparent', outline: 'none' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        }
      },
      animation: {
        'highlight-flash': 'highlight-flash 3s ease-out forwards',
        'pulse-subtle': 'pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
