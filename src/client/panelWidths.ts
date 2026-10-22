export const PANEL_DEFAULTS = { channels: 256, list: 400 };
export const PANEL_MIN = { channels: 200, list: 280 };
export const PANEL_MAX = { channels: 400, list: 720 };
export const READER_MIN = 320;
export const SPLITTER_WIDTH = 8;
export type PanelWidths = typeof PANEL_DEFAULTS;
export type PanelName = keyof PanelWidths;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));
export function panelLimits(containerWidth: number, channels = PANEL_DEFAULTS.channels) {
  const width = Math.max(containerWidth, PANEL_MIN.channels + PANEL_MIN.list + READER_MIN + 2 * SPLITTER_WIDTH);
  return {
    channels: Math.min(PANEL_MAX.channels, width - PANEL_MIN.list - READER_MIN - 2 * SPLITTER_WIDTH),
    list: Math.min(PANEL_MAX.list, width - channels - READER_MIN - 2 * SPLITTER_WIDTH),
  };
}
export function fitPanelWidths(preferred: PanelWidths, containerWidth: number): PanelWidths {
  const channels = clamp(preferred.channels, PANEL_MIN.channels, panelLimits(containerWidth).channels);
  return { channels, list: clamp(preferred.list, PANEL_MIN.list, panelLimits(containerWidth, channels).list) };
}
const storageKey = (userId: string) => `sfeed:panel-widths:v1:${userId}`;
export function readPanelWidths(userId: string): PanelWidths {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(userId)) || 'null');
    return {
      channels: typeof stored?.channels === 'number' && Number.isFinite(stored.channels) ? clamp(stored.channels, PANEL_MIN.channels, PANEL_MAX.channels) : PANEL_DEFAULTS.channels,
      list: typeof stored?.list === 'number' && Number.isFinite(stored.list) ? clamp(stored.list, PANEL_MIN.list, PANEL_MAX.list) : PANEL_DEFAULTS.list,
    };
  } catch { return { ...PANEL_DEFAULTS }; }
}
export function savePanelWidths(userId: string, widths: PanelWidths) {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(widths)); } catch {}
}
