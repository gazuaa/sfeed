// The common consent managers' roots: OneTrust, Cookiebot, Didomi, Quantcast, TrustArc,
// Sourcepoint, Usercentrics, Osano, Termly, CookieYes, Complianz.
const MANAGERS = '#onetrust-consent-sdk,#onetrust-banner-sdk,#onetrust-pc-sdk,.onetrust-pc-dark-filter,#ot-sdk-btn-floating,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,#didomi-host,.didomi-popup-backdrop,.qc-cmp2-container,#qc-cmp2-container,#truste-consent-track,.truste_overlay,.truste_box_overlay,[id^="sp_message_container"],#usercentrics-root,.osano-cm-window,#termly-code-snippet-support,.cky-consent-container,.cky-overlay,#cmplz-cookiebanner-container';
// Button labels run into each other in textContent ("AcceptReject"), so only the start is bounded.
const ASKS = /\b(?:cookie|consent|privacy)/i;
const ANSWERS = /\b(?:accept|reject|agree|allow|decline|manage)/i;

/**
 * A rendered page can carry the cookie banner its scripts opened. A copy runs none of
 * those scripts, sets no cookies and cannot close the banner, so it would only cover the
 * article. Known consent managers go, as do small fixed dialogs that ask about cookies.
 */
export function dropConsentBanners(root: ParentNode) {
  root.querySelectorAll(MANAGERS).forEach((node) => node.remove());
  for (const dialog of Array.from(root.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]'))) {
    const text = (dialog.textContent || '').replace(/\s+/g, ' ');
    if (dialog.isConnected && text.length < 2000 && ASKS.test(text) && ANSWERS.test(text)) dialog.remove();
  }
}
