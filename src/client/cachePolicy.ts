export const RETENTION_OPTIONS = [1, 7, 14, 30, 60, 90] as const;
export const CONTENT_LIMIT = 256 * 1024 * 1024;
export function retentionDays(account: string) {
  try { const days = Number(localStorage.getItem(`sfeed_cache_days:${account}`)); return (RETENTION_OPTIONS as readonly number[]).includes(days) ? days : 30; } catch { return 30; }
}
export const retentionAge = (account: string) => retentionDays(account) * 86400_000;
export function setRetentionDays(account: string, days: number) {
  if (!(RETENTION_OPTIONS as readonly number[]).includes(days)) return;
  try { localStorage.setItem(`sfeed_cache_days:${account}`, String(days)); } catch {}
}
export const estimateBytes = (value: unknown): number => typeof value === 'string' ? value.length * 2 : !value || typeof value !== 'object' ? 8 : Object.entries(value).reduce((sum, [key, child]) => sum + key.length * 2 + estimateBytes(child), 32);
export const cacheGeneration = new Map<string, number>();
