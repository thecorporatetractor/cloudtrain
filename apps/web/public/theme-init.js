// Apply the persisted theme before first paint to avoid a flash. A file, not an
// inline script, so the Content-Security-Policy can stay script-src 'self'.
try {
  var t = localStorage.getItem('ct.theme');
  if (t === 'dark' || t === 'light' || t === 'cream') {
    document.documentElement.setAttribute('data-theme', t);
  }
} catch (e) {}
