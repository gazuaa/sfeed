import { useCallback, useSyncExternalStore } from 'react';
import type { ArticleItem } from './api';

const settingKey = (account: string) => `sfeed_local_notifications:${account}`;
const seenKey = (account: string) => `sfeed_notified_articles:${account}`;
const listeners = new Set<() => void>();
export function localNotificationsEnabled(account: string) {
  try { return Boolean(account && localStorage.getItem(settingKey(account)) === 'true' && typeof Notification !== 'undefined' && Notification.permission === 'granted'); } catch { return false; }
}
export function setLocalNotifications(account: string, enabled: boolean) {
  try { localStorage.setItem(settingKey(account), String(enabled)); } catch { /* session-only environments may block storage */ }
  listeners.forEach((listener) => listener());
}
export function useLocalNotifications(account: string) {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    window.addEventListener('storage', listener); window.addEventListener('focus', listener);
    return () => { listeners.delete(listener); window.removeEventListener('storage', listener); window.removeEventListener('focus', listener); };
  }, [account]);
  return useSyncExternalStore(subscribe, () => localNotificationsEnabled(account), () => false);
}
export async function enableLocalNotifications(account: string): Promise<string> {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return '이 브라우저에서는 알림을 지원하지 않습니다. 아이폰은 홈 화면에 설치한 앱에서 확인해 주세요.';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return '기기 또는 브라우저 설정에서 알림을 허용해 주세요.';
  setLocalNotifications(account, true);
  return '';
}
export async function notifyNewArticles(account: string, articles: ArticleItem[], show?: (title: string, options: NotificationOptions) => Promise<void>, current: () => boolean = () => true) {
  if (!localNotificationsEnabled(account) || !articles.length) return;
  const deliver = async () => {
    if (!localNotificationsEnabled(account) || !current()) return;
    let previous: string[] = [];
    try { previous = JSON.parse(localStorage.getItem(seenKey(account)) || '[]'); if (!Array.isArray(previous)) previous = []; } catch { /* ignore malformed history */ }
    const seen = new Set(previous), fresh = articles.filter((article) => !seen.has(article.id));
    if (!fresh.length) return;
    let display = show;
    if (!display) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.active || !registration.showNotification) return;
      display = (title, options) => registration.showNotification(title, options);
    }
    for (const article of fresh) {
      if (!localNotificationsEnabled(account) || !current()) break;
      if (seen.has(article.id)) continue;
      seen.add(article.id);
      try { localStorage.setItem(seenKey(account), JSON.stringify([...seen].slice(-1000))); } catch { /* notification tags also deduplicate */ }
      await display(article.title, { tag: `sfeed-${account}-${article.id}`, icon: '/icons/icon-192.png', data: { account, articleId: article.id } });
    }
  };
  if (navigator.locks) await navigator.locks.request(`sfeed-notifications:${account}`, { ifAvailable: true }, (lock) => lock ? deliver() : undefined);
  else await deliver();
}
