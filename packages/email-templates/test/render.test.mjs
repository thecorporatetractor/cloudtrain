import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGO_PATH, renderPrivacyConfirm, renderWaitlistLeft, renderWaitlistWelcome } from '../dist/index.js';

const escapeRegExp = (v) => v.replace(/[\\^$.*+?()[\]{}|#-]/g, '\\$&');

const siteUrl = 'https://cloudtrain.app';
const leaveUrl = 'https://cloudtrain.app/waitlist/leave#token=abc.def';
const confirmUrl = 'https://cloudtrain.app/legal/privacy-request#token=xyz';

const all = () => ({
  welcome: renderWaitlistWelcome({ siteUrl, leaveUrl }),
  erasure: renderPrivacyConfirm({ siteUrl, confirmUrl, type: 'erasure' }),
  withdrawal: renderPrivacyConfirm({ siteUrl, confirmUrl, type: 'withdrawal' }),
  export: renderPrivacyConfirm({ siteUrl, confirmUrl, type: 'export' }),
  left: renderWaitlistLeft({ siteUrl }),
});

test('every email has a subject, an html part and a text part', () => {
  for (const [name, e] of Object.entries(all())) {
    assert.ok(e.subject.length > 10 && e.subject.length < 80, `${name}: subject length`);
    assert.match(e.html, /^<!DOCTYPE html>\n<html lang="en"/, `${name}: document`);
    assert.match(e.html, /<title>[^<]+<\/title>/, `${name}: title`);
    assert.match(e.html, /<h1\b/, `${name}: heading`);
    assert.match(e.html, /<meta name="color-scheme" content="light dark">/, `${name}: colour scheme`);
    assert.match(e.html, /prefers-color-scheme:dark/, `${name}: dark mode styles`);
    assert.ok(e.text.endsWith('\n') && !e.text.includes('<'), `${name}: text part is plain`);
    assert.ok(e.text.includes('Privacy questions and requests: gdpr@cloudtrain.app.\n'), `${name}: privacy contact on its own line`);
    assert.ok(e.text.includes('gdpr@cloudtrain.app') && e.text.includes('hello@cloudtrain.app'), `${name}: contact addresses`);
    assert.ok(e.html.includes(`${siteUrl}/legal/privacy"`) && e.text.includes(`${siteUrl}/legal/privacy`), `${name}: privacy link`);
    assert.doesNotMatch(e.html + e.text, /do not reply|no-reply|noreply/i, `${name}: replies are welcome`);
  }
});

test('layout tables are presentational and the logo is a sized PNG with alt text', () => {
  for (const [name, e] of Object.entries(all())) {
    const tables = e.html.match(/<table\b[^>]*>/g) ?? [];
    assert.ok(tables.length > 3, `${name}: tables`);
    for (const t of tables) assert.match(t, /role="presentation"/, `${name}: ${t}`);
    assert.match(e.html, new RegExp(`<img class="em-logo" src="${siteUrl}${LOGO_PATH}" width="\\d+" height="\\d+" alt="CloudTrain"`), `${name}: logo`);
    assert.ok(LOGO_PATH.endsWith('.png'));
  }
});

test('the welcome carries the leave link in html and text, readable, and the not-you line', () => {
  const e = renderWaitlistWelcome({ siteUrl, leaveUrl });
  assert.match(e.html, new RegExp(`href="${escapeRegExp(leaveUrl)}"[^>]*>Leave the waitlist</a>`), 'html leave link');
  assert.ok(e.text.includes(`Leave the waitlist`) && e.text.includes(`\n${leaveUrl}\n`), 'text leave link in full');
  // The leave line is body text, not a tiny grey footnote: 16px in the foreground colour.
  const leaveP = e.html.slice(e.html.lastIndexOf('<p', e.html.indexOf('Leave the waitlist')), e.html.indexOf('Leave the waitlist'));
  assert.match(leaveP, /font-size:16px/);
  assert.match(leaveP, /color:#17191c/);
  assert.match(e.html, /If this wasn’t you/);
  assert.match(e.text, /If this wasn’t you/);
  assert.match(e.text, /joined|added to the CloudTrain early-access waitlist/, 'says why they got it');
});

test('the privacy confirmation carries the confirm link as a button and in full, per type', () => {
  for (const type of ['erasure', 'withdrawal', 'export']) {
    const e = renderPrivacyConfirm({ siteUrl, confirmUrl, type });
    assert.ok(e.html.includes(`href="${confirmUrl}"`), `${type}: html link`);
    assert.ok(e.html.includes(`>${confirmUrl}</a>`), `${type}: link in full`);
    assert.ok(e.text.includes(`\n${confirmUrl}\n`), `${type}: text link`);
    assert.match(e.html, /expires/, `${type}: says it expires`);
    assert.match(e.html, /If it wasn’t you, ignore this message/, `${type}: ignore line`);
  }
  assert.notEqual(renderPrivacyConfirm({ siteUrl, confirmUrl, type: 'erasure' }).subject, renderPrivacyConfirm({ siteUrl, confirmUrl, type: 'export' }).subject);
  assert.throws(() => renderPrivacyConfirm({ siteUrl, confirmUrl, type: 'constructor' }), RangeError);
  assert.throws(() => renderPrivacyConfirm({ siteUrl, confirmUrl, type: 'delete' }), RangeError);
});

test('the left email links nowhere but the site', () => {
  const e = renderWaitlistLeft({ siteUrl });
  const hrefs = [...e.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const h of hrefs) assert.ok(h.startsWith('mailto:') || new URL(h).origin === new URL(siteUrl).origin, h);
});

test('hostile values are escaped in every parameter', () => {
  const hostile = `https://cloudtrain.app/x?q="><script>alert(1)</script><img/src=x/onerror=alert(1)>&'`;
  const cases = [
    renderWaitlistWelcome({ siteUrl: hostile, leaveUrl }),
    renderWaitlistWelcome({ siteUrl, leaveUrl: hostile }),
    renderPrivacyConfirm({ siteUrl: hostile, confirmUrl, type: 'erasure' }),
    renderPrivacyConfirm({ siteUrl, confirmUrl: hostile, type: 'export' }),
    renderWaitlistLeft({ siteUrl: hostile }),
  ];
  for (const e of cases) {
    assert.ok(!e.html.includes('<script'), 'no script');
    assert.doesNotMatch(e.html, /\son[a-z]+=/, 'no handler attribute');
    assert.ok(!e.html.includes('<img/src=x'), 'no injected tag');
    assert.ok(e.html.includes('&lt;script&gt;') || e.html.includes('%3Cscript%3E'), 'escaped');
    for (const [, h] of e.html.matchAll(/href="([^"]*)"/g)) assert.doesNotMatch(h, /[<>]/, 'attribute value keeps no angle brackets');
  }
});

test('links must be absolute http(s): other schemes and junk are refused', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '/relative', '', 'ftp://x', 'https://x.test/a b', 'https://x.test/\u0000']) {
    assert.throws(() => renderWaitlistWelcome({ siteUrl, leaveUrl: bad }), TypeError, `leaveUrl ${JSON.stringify(bad)}`);
    assert.throws(() => renderPrivacyConfirm({ siteUrl, confirmUrl: bad, type: 'erasure' }), TypeError, `confirmUrl ${JSON.stringify(bad)}`);
    assert.throws(() => renderWaitlistLeft({ siteUrl: bad }), TypeError, `siteUrl ${JSON.stringify(bad)}`);
  }
  // A trailing slash on the site is tolerated and never doubled.
  const e = renderWaitlistLeft({ siteUrl: 'https://cloudtrain.app/' });
  const hrefs = [...e.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('mailto:'));
  assert.ok(hrefs.some((h) => new URL(h).origin === 'https://cloudtrain.app' && new URL(h).pathname === '/legal/privacy'));
  assert.ok(hrefs.every((h) => !new URL(h).pathname.startsWith('//')) && !e.html.includes('app//'));
});

test('no tracking: no pixels, scripts, remote resources or click-wrapping; the logo is the only external load', () => {
  for (const [name, e] of Object.entries(all())) {
    assert.doesNotMatch(e.html, /<script|<iframe|<object|<embed|<link\b|@import|url\(/i, `${name}: active or remote content`);
    const srcs = [...e.html.matchAll(/\bsrc="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(srcs, [`${siteUrl}${LOGO_PATH}`], `${name}: only the logo is loaded`);
    assert.doesNotMatch(e.html, /width="1"|height="1"|width:1px;height:1px/, `${name}: pixel`);
    const hrefs = [...e.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const h of hrefs) assert.ok(h.startsWith(`${siteUrl}/`) || h === siteUrl || h.startsWith('mailto:'), `${name}: ${h} is not on the site`);
    for (const h of hrefs) assert.doesNotMatch(h, /utm_|track|click|redirect|[?&]url=/i, `${name}: ${h} looks wrapped`);
    assert.doesNotMatch(e.text, /utm_/, `${name}: text`);
  }
});

test('size budget: well under what Gmail clips', () => {
  for (const [name, e] of Object.entries(all())) {
    const bytes = Buffer.byteLength(e.html, 'utf8');
    assert.ok(bytes < 30_000, `${name}: ${bytes} bytes of html`);
    assert.ok(Buffer.byteLength(e.text, 'utf8') < 4_000, `${name}: text`);
  }
});

test('tap targets: the button is 44px tall and links are not tiny', () => {
  const e = renderPrivacyConfirm({ siteUrl, confirmUrl, type: 'erasure' });
  assert.match(e.html, /padding:12px 24px;[^"]*line-height:20px/, 'button: 12 + 20 + 12');
  // 1px is the hidden preheader and the terminal's dots, which carry no text.
  for (const [name, m] of Object.entries(all())) assert.doesNotMatch(m.html, /font-size:(1[0-2]|[2-9])px/, `${name}: text under 13px`);
});
