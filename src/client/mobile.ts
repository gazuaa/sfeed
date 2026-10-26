import { useSyncExternalStore } from 'react';
const query = '(max-width: 1023px)';
const subscribe = (callback: () => void) => { const media = window.matchMedia(query); media.addEventListener('change', callback); return () => media.removeEventListener('change', callback); };
export const useMobileViewport = () => useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
