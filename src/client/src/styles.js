export const colors = {
  page: '#ffffff',
  card: '#fff',
  cardSoft: '#f8fbff',
  border: '#dbeafe',
  borderStrong: '#93c5fd',
  text: '#0f172a',
  muted: '#475569',
  faint: '#94a3b8',
  accent: '#2563eb',
  accent2: '#3b82f6',
  gold: '#1d4ed8',
  danger: '#dc2626'
};

export const pageStyle = {
  minHeight: '100vh',
  padding: 16,
  boxSizing: 'border-box',
  background: '#ffffff',
  color: colors.text
};

export const cardStyle = {
  background: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  boxShadow: '0 8px 20px rgba(37, 99, 235, 0.06)'
};

export const softCardStyle = {
  ...cardStyle,
  background: '#ffffff'
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
  boxShadow: '0 6px 14px rgba(37, 99, 235, 0.18)'
};

export const outlineButtonStyle = {
  '--border-color': colors.borderStrong,
  '--text-color': colors.accent,
  '--border-radius': '8px',
  fontWeight: 400,
  background: '#ffffff'
};

export const inputBoxStyle = {
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: 8,
  padding: '10px 12px',
  background: '#ffffff',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)'
};

export const listStyle = {
  background: '#ffffff',
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
  background: '#fff',
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
