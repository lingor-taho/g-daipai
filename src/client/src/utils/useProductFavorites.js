import { useEffect, useMemo, useState } from 'react';
import { Toast } from 'antd-mobile';
import { favoritesKey, readFavorites, toggleFavorite } from './productFavorites';

export default function useProductFavorites() {
  const read = () => {
    try { return readFavorites(localStorage, favoritesKey(localStorage)); } catch (_) { return []; }
  };
  const [favorites, setFavorites] = useState(read);
  const sortedFavorites = useMemo(() => {
    const endTime = item => {
      const value = Date.parse(item.endTime);
      return Number.isFinite(value) ? value : Infinity;
    };
    return [...favorites].sort((a, b) => endTime(a) - endTime(b));
  }, [favorites]);
  useEffect(() => {
    const refresh = () => setFavorites(read());
    window.addEventListener('storage', refresh);
    window.addEventListener('acting-user-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('acting-user-change', refresh);
    };
  }, []);
  const onToggleFavorite = item => {
    try {
      const result = toggleFavorite(localStorage, favoritesKey(localStorage), item);
      setFavorites(result.items);
      Toast.show({ content: result.added ? '已加入收藏，更换设备或浏览器会清空收藏' : '已取消收藏' });
    } catch (_) {
      Toast.show({ content: '收藏保存失败，请检查浏览器本地存储是否可用' });
    }
  };
  return { favorites: sortedFavorites, onToggleFavorite };
}
