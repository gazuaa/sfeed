interface ImageNode {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
interface ImageRoot { querySelectorAll(selector: string): Iterable<ImageNode> }

const LAZY_SOURCES = ['data-src', 'data-lazy-src', 'data-original', 'data-original-src', 'data-actualsrc', 'data-lazy'];
const LAZY_SETS = ['data-srcset', 'data-lazy-srcset'];
// A stand-in that only reserves the image's space until a script swaps the real one in.
const PLACEHOLDER_FILE = /\/(?:img[-_])?(?:1x1|blank|spacer|pixel|transparent|placeholder|lazy|lazyload|loading|empty|clear|grey|gray)(?:[-_]?(?:\d+x\d+|\d+|img|image))?\.(?:gif|png|svg|webp)(?:[?#]|$)/i;
export const isPlaceholderImage = (src: string) => /^data:/i.test(src) ? src.length < 256 : PLACEHOLDER_FILE.test(src);

function resolve(value: string, base?: string) {
  if (!base) return value;
  try { return new URL(value, base).href; } catch { return value; }
}
const resolveSet = (set: string, base?: string) => set.split(',').map((candidate) => {
  const [url, ...descriptor] = candidate.trim().split(/\s+/);
  return [resolve(url, base), ...descriptor].join(' ');
}).join(', ');

const first = (node: ImageNode, names: string[], usable: (value: string) => boolean) =>
  names.map((name) => node.getAttribute(name)?.trim() ?? '').find((value) => value && usable(value));

/**
 * Pages copied without their scripts never run the lazy loader, so images
 * keep a 1×1 stand-in sized to the real photo and show as a blank gap. Put
 * the real address in place, and drop images left with only a stand-in.
 */
export function revealLazyImages(root: ImageRoot, base?: string) {
  for (const source of root.querySelectorAll('source')) {
    const set = first(source, LAZY_SETS, () => true);
    if (set) source.setAttribute('srcset', resolveSet(set, base));
  }
  for (const img of root.querySelectorAll('img')) {
    const lazy = first(img, LAZY_SOURCES, (value) => !/^data:/i.test(value) && !/\s/.test(value));
    if (lazy) img.setAttribute('src', resolve(lazy, base));
    const set = first(img, LAZY_SETS, () => true);
    if (set) img.setAttribute('srcset', resolveSet(set, base));
    // An address the lazy loader would have used is the real image, whatever its name.
    const src = img.getAttribute('src')?.trim() ?? '';
    if (!lazy && !img.getAttribute('srcset') && (!src || isPlaceholderImage(src))) img.remove();
  }
}
