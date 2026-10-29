const MEDIA = 'img,picture,video,audio,svg,canvas,iframe,object,embed';
const NAMED = /(?:^|[-_])sidebar$/i;

/** Text a reader sees: widgets often carry their own style blocks. */
function shownLength(node: Element) {
  const hidden = Array.from(node.querySelectorAll('style,script,noscript,template')).reduce((sum, part) => sum + (part.textContent?.length || 0), 0);
  return Math.max(0, (node.textContent?.replace(/\s+/g, ' ').length || 0) - hidden);
}

/** The block holding most of the article's paragraph text. */
function articleText(root: ParentNode) {
  const sums = new Map<Element, number>();
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (p.parentElement) sums.set(p.parentElement, (sums.get(p.parentElement) || 0) + (p.textContent?.trim().length || 0));
  }
  let best: Element | null = null, most = 200;
  for (const [block, length] of sums) if (length > most) { best = block; most = length; }
  return best;
}

/**
 * Columns beside an article (aside, complementary, *-sidebar) list other stories and
 * ads. A copy shows the article alone, so ones outside its text that are mostly links,
 * or blank, go. Boxes of prose such as key points stay, as does anything in the text.
 */
export function dropSidebars(root: ParentNode) {
  const text = articleText(root);
  if (!text) return;
  const candidates = Array.from(root.querySelectorAll('aside,[role="complementary"],[class*="idebar"],[id*="idebar"]')).filter((node) =>
    node.tagName === 'ASIDE' || node.getAttribute('role') === 'complementary'
    || (node.getAttribute('class') || '').split(/\s+/).some((name) => NAMED.test(name)) || NAMED.test(node.id));
  for (const node of candidates) {
    if (node.contains(text) || text.contains(node)) continue;
    const length = shownLength(node);
    const linked = Array.from(node.querySelectorAll('a')).reduce((sum, link) => sum + shownLength(link), 0);
    if (length > 20 ? linked / length >= 0.5 : !node.querySelector(MEDIA)) node.remove();
  }
}
