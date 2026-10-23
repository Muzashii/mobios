// Design tokens — "oficina de precisão". CSS variables in src/ui/theme.css mirror these.
// Components use the CSS variables (via Tailwind theme) or these constants for WebGL.

export const ACCENT = '#FF6B2C';

export const tokens = {
  dark: {
    bg: '#0E0F12',
    surface: '#16171B',
    surface2: '#1D1F24',
    surface3: '#262930',
    line: '#2E3138',
    text: '#ECEDEF',
    muted: '#9A9DA6',
    accent: ACCENT,
    accentText: '#160A04',
    danger: '#FF5A5F',
    warning: '#F5B544',
    success: '#3DD68C',
    viewportTop: '#1A1C21',
    viewportBottom: '#0C0D10',
    grid: '#2A2D34',
    gridStrong: '#3A3E47',
  },
  light: {
    bg: '#F3F2EF',
    surface: '#FFFFFF',
    surface2: '#F7F6F3',
    surface3: '#ECEAE5',
    line: '#DEDBD4',
    text: '#17181B',
    muted: '#5E616B',
    accent: '#C2410C',
    accentText: '#FFFFFF',
    danger: '#D93036',
    warning: '#B7791F',
    success: '#1E9E62',
    viewportTop: '#F4F3F0',
    viewportBottom: '#DCDAD5',
    grid: '#D3D0C9',
    gridStrong: '#BDB9B0',
  },
} as const;

export type ThemeName = keyof typeof tokens;

/** Distinct, harmonious part colours (golden-angle hues, muted for a workshop look). */
const PART_COLORS = ['#D9D4CA', '#7FB3D5', '#E8A87C', '#9BC89B', '#C3A6D8', '#E6CF7A', '#86C5C0', '#E59A9A', '#A7B6E8', '#C9B79C'];

export function autoPartColor(index: number): string {
  return PART_COLORS[index % PART_COLORS.length];
}

export const CUT_A = '#7FB3D5';
export const CUT_B = ACCENT;
