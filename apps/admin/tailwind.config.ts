import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#FF5577', 500: '#FF5577', 700: '#B02246' },
        warm: { DEFAULT: '#FF8A7A', 500: '#FF8A7A' },
        ink: {
          50: '#F7F7FA',
          100: '#E8E8EC',
          300: '#B5B5BD',
          500: '#73737D',
          700: '#3D3D45',
          900: '#1A1A1F',
        },
      },
    },
  },
  plugins: [],
};
export default config;
