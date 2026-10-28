const MEDIA = 'img,picture,video,audio,svg,canvas,iframe,object,embed';
const RESERVED = /(?:^|;)\s*(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)px/i;

const empty = (node: Element) => !node.textContent?.trim() && !node.querySelector(MEDIA);

/**
 * Ad and widget slots reserve their height inline and are filled in by scripts. A copy
 * without scripts would show them as tall blank gaps, so empty ones go, along with the
 * wrappers they leave empty. Positioned and painted boxes take no gap and stay.
 */
export function dropEmptySlots(root: ParentNode) {
  for (const slot of Array.from(root.querySelectorAll('[style*="height"]'))) {
    const style = slot.getAttribute('style') || '';
    const reserved = RESERVED.exec(style);
    if (!reserved || Number(reserved[1]) < 50 || /position\s*:\s*(?:absolute|fixed)|background/i.test(style) || !empty(slot)) continue;
    let node: Element = slot;
    while (node.parentElement && /^(?:DIV|SECTION|ASIDE|FIGURE)$/.test(node.parentElement.tagName) && empty(node.parentElement)) node = node.parentElement;
    node.remove();
  }
}
