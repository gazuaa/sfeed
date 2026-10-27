export const AUTO_REFRESH_OPTIONS = [0, 1, 5, 10, 15, 30, 60] as const;
export const DEFAULT_AUTO_REFRESH_MINUTES = 15;
export const validAutoRefresh = (value: unknown): value is number => typeof value === 'number' && (AUTO_REFRESH_OPTIONS as readonly number[]).includes(value);
