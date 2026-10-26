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

export function isIOSSafari(browser: { userAgent: string; maxTouchPoints?: number; standalone?: boolean; brave?: unknown }): boolean {
  const named = /CriOS|FxiOS|EdgiOS|OPiOS|Brave|Whale|SamsungBrowser|NAVER|DaumApps|KAKAOTALK|Instagram|FBAN|FBAV|Line/i.test(browser.userAgent);
  return installPlatform(browser.userAgent, browser.maxTouchPoints) === 'ios' && typeof browser.standalone !== 'undefined' && !named && !browser.brave;
}

// Same handoff as MUUSED: start copying before navigating synchronously, so
// the Safari scheme retains the user's tap. A browser switch is not guaranteed;
// only show the manual fallback when no page-leave event was observed.
export function openInSafari(onStuck: (copied: boolean) => void): () => void {
  const address = installAddress(window.location.href);
  let copied = false;
  let left = false;
  const markLeft = () => { left = true; };
  try { void navigator.clipboard?.writeText(address).then(() => { copied = true; }).catch(() => {}); } catch { /* manual copying remains available */ }
  document.addEventListener('visibilitychange', markLeft, { once: true });
  window.addEventListener('pagehide', markLeft, { once: true });
  const cleanup = () => { document.removeEventListener('visibilitychange', markLeft); window.removeEventListener('pagehide', markLeft); clearTimeout(timer); };
  const timer = setTimeout(() => { cleanup(); if (!left) onStuck(copied); }, 1400);
  try { window.location.href = `x-safari-${address}`; } catch { /* unsupported schemes use the timed fallback */ }
  return cleanup;
}

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
let cancelHandoff: (() => void) | null = null;
export function openInstallHelp() {
  cancelHandoff?.();
  if (installPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ios' && !isIOSSafari(navigator)) {
    cancelHandoff = openInSafari((copied) => window.dispatchEvent(new CustomEvent('sfeed:install', { detail: { safariFailed: true, copied } })));
  } else window.dispatchEvent(new Event('sfeed:install'));
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => { void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {}); };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
