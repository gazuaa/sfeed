import { useSyncExternalStore } from 'react';

export function installPlatform(userAgent: string, maxTouchPoints = 0): 'ios' | 'android' | 'mac-safari' | 'desktop' {
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  if (/Macintosh/.test(userAgent) && /Safari/.test(userAgent) && !/Chrome|Chromium|Edg|Brave/.test(userAgent)) return 'mac-safari';
  return 'desktop';
}

// Only transfer the public app address to another browser, never login tokens
// or private route/query information from the current page.
export const installAddress = (address: string) => new URL('/', address).href;

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const standalone = () => typeof window !== 'undefined' && (installed || window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred = event as InstallEvent; notify(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; notify(); });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', notify);
}
export function installState() { return standalone() ? 'installed' : deferred ? 'prompt' : 'manual'; }
export function useInstallState() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, installState, () => 'manual');
}
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  try {
    await event.prompt();
    if ((await event.userChoice).outcome === 'accepted') { installed = true; notify(); }
    return true;
  } catch { return false; }
}
export function openInstallHelp() { window.dispatchEvent(new Event('sfeed:install')); }

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => { void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {}); };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
