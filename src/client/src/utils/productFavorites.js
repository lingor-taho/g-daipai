const PREFIX = 'productFavorites:v1:';

export function favoritesKey(storage) {
  const username = storage.getItem('actingUsername') || storage.getItem('username');
  if (!username) throw new Error('请先登录后收藏');
  return PREFIX + encodeURIComponent(username);
}

export function favoriteSnapshot(item) {
  const auctionId = String(item?.auctionId || '').toLowerCase();
  if (!/^[a-z]?\d{8,10}$/.test(auctionId)) return null;
  const epoch = Number(item.endTimeEpoch);
  const parsed = item.endTime ? Date.parse(item.endTime) : NaN;
  const endMs = Number.isFinite(parsed) ? parsed : (epoch > 0 ? epoch * 1000 : NaN);
  return {
    auctionId,
    title: String(item.title || auctionId),
    imageUrl: String(item.imageUrl || ''),
    endTime: Number.isFinite(endMs) ? new Date(endMs).toISOString() : ''
  };
}

export function readFavorites(storage, key) {
  try {
    const values = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(values)) return [];
    return [...new Map(values.map(favoriteSnapshot).filter(Boolean).map(item => [item.auctionId, item])).values()];
  } catch (_) { return []; }
}

export function toggleFavorite(storage, key, item) {
  const snapshot = favoriteSnapshot(item);
  if (!snapshot) throw new Error('商品信息不完整，无法收藏');
  const current = readFavorites(storage, key);
  const added = !current.some(value => value.auctionId === snapshot.auctionId);
  const items = added ? [snapshot, ...current] : current.filter(value => value.auctionId !== snapshot.auctionId);
  storage.setItem(key, JSON.stringify(items));
  return { items, added };
}

export function remainingFavoriteDays(endTime, now = Date.now()) {
  const endMs = Date.parse(endTime);
  return Number.isFinite(endMs) ? Math.max(0, Math.ceil((endMs - now) / 86400000)) : null;
}
