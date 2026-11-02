/*
 * Dynamic values are the only untrusted input of a template. Every one of them
 * goes through here: text is escaped for HTML, URLs are checked to be absolute
 * http(s) links before they are escaped, so an `href` can never carry another
 * scheme however the caller was tricked into building it.
 */

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes a string for an HTML text node or a quoted attribute. */
export function esc(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

/** An absolute http or https URL, with no control characters, else an error. Returns it unescaped. */
export function checkUrl(name: string, value: string): string {
  if (typeof value !== 'string' || !value) throw new TypeError(`${name}: a URL is required`);
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new TypeError(`${name}: not an absolute URL`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new TypeError(`${name}: only http(s) links can be sent`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(value)) throw new TypeError(`${name}: control characters or whitespace in URL`);
  return value;
}

/** The site: its origin without a trailing slash (`https://cloudtrain.app`) and the host people read (`cloudtrain.app`). */
export function site(siteUrl: string): { origin: string; host: string } {
  let origin = checkUrl('siteUrl', siteUrl);
  while (origin.endsWith('/')) origin = origin.slice(0, -1);
  return { origin, host: new URL(origin).host };
}
