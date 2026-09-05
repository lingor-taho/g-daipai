export default function FavoriteButton({ active, onClick }) {
  return (
    <button type="button" aria-label={active ? '取消商品收藏' : '收藏商品'} aria-pressed={active}
      onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, flexShrink: 0, padding: 6, border: 0, background: 'transparent', cursor: 'pointer' }}>
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z"
          fill={active ? '#facc15' : 'none'} stroke={active ? '#eab308' : '#9ca3af'} strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
