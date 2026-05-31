import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置 · 暖色系（玫红 + 暖橙粉）
 *
 * 对齐 prototypes/* + DESIGN-SYSTEM.md：
 * - 主色：玫红 #FF5577（active/CTA）
 * - 辅色：暖橙粉 #FF8A7A（warm accent）
 * - 严禁使用蓝紫色（旧 #5B6FE8 已全局清理）
 * - 字体：Noto Serif SC（中文标题）+ Cormorant Garamond italic（小标签）+ Playfair Display（数字）+ Inter（正文）
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#FF5577',
          50: '#FFF1F4',
          100: '#FFE0E7',
          200: '#FFB8C8',
          300: '#FF8FA8',
          400: '#FF6688',
          500: '#FF5577',
          600: '#E5305C',
          700: '#B02246',
          800: '#7C1832',
          900: '#4E0F20',
        },
        warm: {
          DEFAULT: '#FF8A7A',
          50: '#FFF4F2',
          100: '#FFE5E0',
          200: '#FFC9BF',
          300: '#FFAD9E',
          400: '#FF8A7A',
          500: '#FF6B58',
          600: '#E54F3C',
          700: '#C13A29',
        },
        ink: {
          950: '#0E0E12',
          900: '#1A1A1F',
          800: '#1A1A2E', // prototype 主色（略带蓝调，比 900 更深沉）
          700: '#3D3D45',
          600: '#6A7088', // prototype 次级文字
          500: '#73737D',
          300: '#B5B5BD',
          200: '#9A9FB5',
          100: '#E8E8EC',
          50: '#F7F7FA',
        },
        success: { 500: '#2DCE89' },
        warning: { 500: '#FFB347' },
        danger: { 500: '#FF4757' },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Noto Sans SC', 'sans-serif'],
        serif: ['Noto Serif SC', 'serif'],
        cormorant: ['Cormorant Garamond', 'serif'],
        display: ['Playfair Display', 'serif'],
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
      maxWidth: {
        h5: '390px',
      },
      // UI 规范 v1：页面间距 4 档语义，与 PageContainer variant 对齐
      // page-xs(12) compact 内嵌 · page-sm(16) compact · page-md(20) default · page-lg(24) padded
      spacing: {
        'page-xs': '12px',
        'page-sm': '16px',
        'page-md': '20px',
        'page-lg': '24px',
      },
      boxShadow: {
        // 暖粉系阴影（对齐 prototype）
        'warm-xs': '0 2px 8px rgba(255, 138, 122, 0.08)',
        'warm-sm': '0 4px 14px rgba(255, 138, 122, 0.10)',
        'warm-md': '0 6px 20px rgba(255, 138, 122, 0.15)',
        'warm-lg': '0 12px 30px rgba(255, 138, 122, 0.25)',
        'warm-xl': '0 16px 36px rgba(255, 138, 122, 0.35)',
        'rose-md': '0 4px 14px rgba(255, 85, 119, 0.25)',
        'rose-lg': '0 8px 24px rgba(255, 85, 119, 0.30)',
      },
      backgroundImage: {
        'gradient-cta': 'linear-gradient(135deg, #FF8A7A 0%, #FF5577 50%, #E5305C 100%)',
        'gradient-warm-rose': 'linear-gradient(135deg, #FF8A7A 0%, #FF5577 100%)',
        'gradient-soft': 'linear-gradient(180deg, #FFF4F2 0%, #FAFAFA 60%)',
        'gradient-dark': 'linear-gradient(135deg, #1A1A1F 0%, #0E0E12 50%, #1A1A1F 100%)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'ai-ring': {
          '0%': { transform: 'scale(0.95)', opacity: '0.8' },
          '100%': { transform: 'scale(1.3)', opacity: '0' },
        },
        'dot-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'typing': {
          '0%, 60%, 100%': { opacity: '0.3', transform: 'translateY(0)' },
          '30%': { opacity: '1', transform: 'translateY(-4px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 500ms cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'ring-pulse': 'ai-ring 2.4s ease-out infinite',
        'dot-pulse': 'dot-pulse 2s infinite',
        'typing': 'typing 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
