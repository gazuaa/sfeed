import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
try {
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  const { fitPanelWidths, readPanelWidths, savePanelWidths, PANEL_DEFAULTS, PANEL_MIN, READER_MIN, SPLITTER_WIDTH } = await vite.ssrLoadModule('/src/client/panelWidths.ts');
  for (const width of [1024, 1120, 1400, 1920]) {
    for (const wanted of [{ channels: 1, list: 1 }, PANEL_DEFAULTS, { channels: 400, list: 720 }, { channels: 9000, list: 9000 }]) {
      const result = fitPanelWidths(wanted, width);
      assert.ok(result.channels >= PANEL_MIN.channels);
      assert.ok(result.list >= PANEL_MIN.list);
      assert.ok(width - result.channels - result.list - 2 * SPLITTER_WIDTH >= READER_MIN, 'reader must remain usable');
    }
  }
  const preferred = { channels: 400, list: 720 };
  assert.deepEqual(fitPanelWidths(preferred, 1024), { channels: 400, list: 288 });
  assert.deepEqual(fitPanelWidths(preferred, 1920), preferred, 'widening the window restores the preferred sizes');
  assert.deepEqual(preferred, { channels: 400, list: 720 }, 'responsive clamping must not overwrite preferences');
  assert.deepEqual(readPanelWidths('one'), PANEL_DEFAULTS);
  savePanelWidths('one', preferred);
  assert.deepEqual(readPanelWidths('one'), preferred);
  assert.deepEqual(readPanelWidths('two'), PANEL_DEFAULTS, 'different accounts must have separate widths');
  storage.set('sfeed:panel-widths:v1:one', '{broken');
  assert.deepEqual(readPanelWidths('one'), PANEL_DEFAULTS);
  storage.set('sfeed:panel-widths:v1:one', JSON.stringify({ channels: -2, list: 'invalid' }));
  assert.deepEqual(readPanelWidths('one'), { channels: 200, list: PANEL_DEFAULTS.list });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage disabled'); } });
  assert.deepEqual(readPanelWidths('one'), PANEL_DEFAULTS);
  assert.doesNotThrow(() => savePanelWidths('one', preferred));
  console.log('PASS: pane minimums, reader space, responsive clamping/restoration, account-specific persistence and malformed/unavailable storage.');
} finally {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
  await vite.close();
}
