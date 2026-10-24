// Apply the persisted theme before first paint to avoid a flash. A file, not an
// inline script, so the Content-Security-Policy can stay script-src 'self'.
// Also marks <html class="motion"> when the visitor allows motion, so the website's
// entrances (src/site/motion) can start from their hidden state without a blink.
try {
  if (window.matchMedia && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('motion');
  }
} catch (e) {}
try {
  var t = localStorage.getItem('ct.theme');
  if (t === 'dark' || t === 'light' || t === 'cream') {
    document.documentElement.setAttribute('data-theme', t);
  }
} catch (e) {}
