const HIDDEN = new Set(['hidden', 'sr-only', 'screen-reader-text', 'visually-hidden']);

/**
 * Site class names would pick up the app's own utility styles (flex, grid, widths) and
 * break the layout, so article content keeps none. What the site hid on phones or kept
 * only for screen readers is dropped rather than revealed.
 */
export function dropSiteClasses(root: ParentNode) {
  for (const node of Array.from(root.querySelectorAll('[class]'))) {
    if ((node.getAttribute('class') || '').split(/\s+/).some((name) => HIDDEN.has(name))) node.remove();
    else node.removeAttribute('class');
  }
}
