export const USER_THEME_STORAGE_KEY = 'clientUiTheme';

export const themeOptions = [
  { value: 'classic', label: '经典' },
  { value: 'japanese', label: '日系' },
  { value: 'fresh', label: '清新' },
  { value: 'western', label: '欧美' },
  { value: 'classic_cn', label: '夜晚' }
];

const themeVars = {
  classic: {
    page: '#ffffff',
    card: '#ffffff',
    cardSoft: '#f8fbff',
    border: '#dbeafe',
    borderStrong: '#93c5fd',
    text: '#0f172a',
    muted: '#475569',
    faint: '#94a3b8',
    accent: '#2563eb',
    accent2: '#3b82f6',
    gold: '#1d4ed8',
    danger: '#dc2626',
    noticeBg: '#f8fbff',
    cancelledBg: '#fff1f0',
    completedBg: '#e6f4ff',
    shadow: 'rgba(37, 99, 235, 0.08)',
    buttonShadow: 'rgba(37, 99, 235, 0.18)'
  },
  japanese: {
    page: '#fffaf3',
    card: '#fffdf8',
    cardSoft: '#f7efe3',
    border: '#ead9be',
    borderStrong: '#d4b383',
    text: '#2f261f',
    muted: '#78685a',
    faint: '#aa9884',
    accent: '#0f766e',
    accent2: '#14b8a6',
    gold: '#b7791f',
    danger: '#dc2626',
    noticeBg: '#fff7e6',
    cancelledBg: '#fff1ec',
    completedBg: '#edf7f4',
    shadow: 'rgba(119, 77, 31, 0.10)',
    buttonShadow: 'rgba(15, 118, 110, 0.18)'
  },
  fresh: {
    page: '#ffffff',
    card: '#ffffff',
    cardSoft: '#f0fdf4',
    border: '#bbf7d0',
    borderStrong: '#86efac',
    text: '#10231b',
    muted: '#527062',
    faint: '#8fb3a1',
    accent: '#16a34a',
    accent2: '#fb7185',
    gold: '#e11d48',
    danger: '#ef4444',
    noticeBg: '#fff1f2',
    cancelledBg: '#fff1f2',
    completedBg: '#ecfdf5',
    shadow: 'rgba(22, 163, 74, 0.08)',
    buttonShadow: 'rgba(22, 163, 74, 0.18)'
  },
  western: {
    page: '#f8fafc',
    card: '#ffffff',
    cardSoft: '#f1f5f9',
    border: '#cbd5e1',
    borderStrong: '#64748b',
    text: '#111827',
    muted: '#4b5563',
    faint: '#9ca3af',
    accent: '#1f4f7a',
    accent2: '#0ea5e9',
    gold: '#334155',
    danger: '#b91c1c',
    noticeBg: '#eef4fb',
    cancelledBg: '#fef2f2',
    completedBg: '#e8f0f8',
    shadow: 'rgba(15, 23, 42, 0.09)',
    buttonShadow: 'rgba(31, 79, 122, 0.20)'
  },
  classic_cn: {
    page: '#0f172a',
    card: '#111827',
    cardSoft: '#172033',
    border: '#263247',
    borderStrong: '#475569',
    text: '#e5e7eb',
    muted: '#a7b0bf',
    faint: '#758195',
    accent: '#60a5fa',
    accent2: '#38bdf8',
    gold: '#93c5fd',
    danger: '#fb7185',
    noticeBg: '#162036',
    cancelledBg: '#311820',
    completedBg: '#12283a',
    shadow: 'rgba(0, 0, 0, 0.30)',
    buttonShadow: 'rgba(96, 165, 250, 0.28)'
  }
};

export const colors = {
  page: 'var(--client-page)',
  card: 'var(--client-card)',
  cardSoft: 'var(--client-card-soft)',
  border: 'var(--client-border)',
  borderStrong: 'var(--client-border-strong)',
  text: 'var(--client-text)',
  muted: 'var(--client-muted)',
  faint: 'var(--client-faint)',
  accent: 'var(--client-accent)',
  accent2: 'var(--client-accent-2)',
  gold: 'var(--client-gold)',
  danger: 'var(--client-danger)',
  noticeBg: 'var(--client-notice-bg)',
  cancelledBg: 'var(--client-cancelled-bg)',
  completedBg: 'var(--client-completed-bg)',
  shadow: 'var(--client-shadow)',
  buttonShadow: 'var(--client-button-shadow)'
};

function normalizeThemeName(value) {
  return themeVars[value] ? value : 'classic';
}

export function getClientTheme() {
  if (typeof localStorage === 'undefined') return 'classic';
  return normalizeThemeName(localStorage.getItem(USER_THEME_STORAGE_KEY) || 'classic');
}

export function applyClientTheme(themeName) {
  if (typeof document === 'undefined') return 'classic';
  const normalized = normalizeThemeName(themeName);
  const root = document.documentElement;
  const vars = themeVars[normalized];
  Object.entries(vars).forEach(([key, value]) => {
    const cssKey = key === 'accent2'
      ? 'accent-2'
      : key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    root.style.setProperty(`--client-${cssKey}`, value);
  });
  root.setAttribute('data-client-theme', normalized);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(USER_THEME_STORAGE_KEY, normalized);
  }
  return normalized;
}

export function getThemeVariables(themeName) {
  return themeVars[normalizeThemeName(themeName)];
}

if (typeof document !== 'undefined') {
  applyClientTheme(getClientTheme());
}

export const pageStyle = {
  minHeight: '100vh',
  padding: 16,
  boxSizing: 'border-box',
  background: colors.page,
  color: colors.text
};

export const cardStyle = {
  background: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  boxShadow: `0 8px 20px ${colors.shadow}`
};

export const softCardStyle = {
  ...cardStyle,
  background: colors.card
};

export const sectionTitleStyle = {
  fontSize: 15,
  fontWeight: 600,
  color: colors.text,
  letterSpacing: 0
};

export const primaryButtonStyle = {
  '--background-color': colors.accent,
  '--border-color': colors.accent,
  '--text-color': '#fff',
  '--border-radius': '8px',
  fontWeight: 400,
  boxShadow: `0 6px 14px ${colors.buttonShadow}`
};

export const outlineButtonStyle = {
  '--border-color': colors.borderStrong,
  '--text-color': colors.accent,
  '--border-radius': '8px',
  fontWeight: 400,
  background: colors.card
};

export const inputBoxStyle = {
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: 8,
  padding: '10px 12px',
  background: colors.card,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)'
};

export const listStyle = {
  background: colors.card,
  border: 0,
  borderRadius: 0,
  boxShadow: 'none',
  overflow: 'hidden',
  '--border-top': '0',
  '--border-bottom': '0',
  '--header-border-bottom': '1px solid #eee',
  '--adm-color-border': '#eee',
  '--prefix-width': '86px'
};

export const itemCardStyle = {
  border: 0,
  borderRadius: 0,
  background: colors.card,
  boxShadow: 'none'
};

export const imageThumbStyle = {
  width: 86,
  height: 86,
  objectFit: 'cover',
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  flex: '0 0 86px',
  background: colors.cardSoft
};

export function pageButtonStyle(active) {
  return active ? primaryButtonStyle : outlineButtonStyle;
}
