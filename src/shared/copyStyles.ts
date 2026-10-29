/**
 * A sandboxed copy has no origin, so a stylesheet it asks for with CORS goes out as
 * "Origin: null", and CDNs that answer only the site itself refuse it: the copy shows
 * unstyled. A plain request still applies the sheet. Integrity checks need CORS, so they go too.
 */
export function plainCopyStyles(root: ParentNode) {
  for (const link of Array.from(root.querySelectorAll('link[rel~="stylesheet"][crossorigin], link[rel~="stylesheet"][integrity]'))) {
    link.removeAttribute('crossorigin');
    link.removeAttribute('integrity');
  }
}
