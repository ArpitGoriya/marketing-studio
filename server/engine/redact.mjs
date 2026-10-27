// Hides personal details on screen before anything is captured: phone numbers and email addresses in the page's text
// (and in fields) become dots, keeping their length. Runs in the page and keeps up with anything that appears later.
export const REDACT = `
(() => {
  const PHONE = /(\\+?\\d[\\d\\s-]{8,}\\d)/g;
  const EMAIL = /[\\w.+-]+@[\\w-]+\\.[\\w.]+/g;
  const hide = (s) => s.replace(EMAIL, (m) => m[0] + '•••@•••').replace(PHONE, (m) => m.replace(/\\d(?=(?:\\D*\\d){2})/g, '•'));
  const walk = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = n.nodeValue;
      if (v && (PHONE.test(v) || EMAIL.test(v))) n.nodeValue = hide(v);
      PHONE.lastIndex = 0; EMAIL.lastIndex = 0;
    }
    for (const el of (root.querySelectorAll ? root.querySelectorAll('input,textarea') : [])) {
      if (el.value && (PHONE.test(el.value) || EMAIL.test(el.value))) el.value = hide(el.value);
      PHONE.lastIndex = 0; EMAIL.lastIndex = 0;
    }
  };
  const start = () => {
    walk(document.body);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => (n.nodeType === 3 ? walk(n.parentNode || document.body) : n.nodeType === 1 && walk(n))))).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
`;
