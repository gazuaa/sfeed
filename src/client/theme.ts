import type { ThemeMode } from './api';

export function readStoredTheme(): ThemeMode {
  try { return localStorage.getItem('sfeed:theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#020617' : '#f8fafc');
  try { localStorage.setItem('sfeed:theme', theme); } catch {}
}
