import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrivacyConfirm, renderWaitlistLeft, renderWaitlistWelcome } from '../dist/index.js';

/*
 * The emails are notifications, sent on the basis of the recipient's consent to
 * be contacted about early access. Promotional content would change that basis,
 * so the copy is checked against a denylist: marketing vocabulary, asks, and
 * promises the site does not make (a date, a queue position, a price).
 */

const siteUrl = 'https://cloudtrain.app';
const emails = {
  welcome: renderWaitlistWelcome({ siteUrl, leaveUrl: `${siteUrl}/waitlist/leave#token=t` }),
  erasure: renderPrivacyConfirm({ siteUrl, confirmUrl: `${siteUrl}/legal/privacy-request#token=t`, type: 'erasure' }),
  withdrawal: renderPrivacyConfirm({ siteUrl, confirmUrl: `${siteUrl}/legal/privacy-request#token=t`, type: 'withdrawal' }),
  export: renderPrivacyConfirm({ siteUrl, confirmUrl: `${siteUrl}/legal/privacy-request#token=t`, type: 'export' }),
  left: renderWaitlistLeft({ siteUrl }),
};

const DENY = [
  /\bdiscount/i,
  /\boffer(s|ed|ing)?\b(?! ?s:)/i, // "no offers" is allowed below
  /\bpromo/i,
  /\bsale\b/i,
  /\bdeal\b/i,
  /\bfree trial/i,
  /\bpricing\b/i,
  /\bprice(s|d)?\b/i,
  /\€|\$\d|EUR\b/,
  /\bper (month|minute|seat)\b/i,
  /\bsubscri(be|ption)/i,
  /\bupgrade/i,
  /\bunlock/i,
  /\bexclusive/i,
  /\blimited (time|spots|places)/i,
  /\bhurry/i,
  /\bdon.t miss/i,
  /\bfollow us/i,
  /\btwitter|linkedin|instagram|facebook|youtube|discord|mastodon|bluesky/i,
  /\bshare (this|with)/i,
  /\brefer(ral)?\b/i,
  /\binvite (a|your) friend/i,
  /\bfeature(s|d)?\b/i,
  /\bexplore\b/i,
  /\bcatalog/i,
  /\blab(s)? (on|with|for)\b/i,
  /\bkubernetes|\blinux\b|\bnetworking/i, // no product tour
  /\bposition\b|\bqueue\b|\bnumber \d+|#\d+ in line/i, // no place in a queue
  /\b(Q[1-4]|January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/, // no date
  /\b20(2[6-9]|3\d)\b/, // no year either
  /\bexactly one (email|message)\b|\bonly one (email|message)\b/i, // the site promises a message, not a count
  /!/, // no exclamation marks
  /\bdo not reply|no-?reply/i,
  /\b(Ltd|GmbH|SRL|S\.R\.L\.|Inc\.?|LLC|B\.V\.|company)\b/, // no company exists yet
  /\bregistered (office|company|address)/i,
  /\bnewsletter(?!s, no offers)/i, // "no newsletters, no offers" is the one allowed mention
];

const withoutComments = (html) => {
  let out = html;
  for (let prev; prev !== out; ) {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/g, '');
  }
  return out;
};

const textOf = (html) =>
  withoutComments(html)
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/, '') // the preheader
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ');

test('no marketing, no promises the site does not make, no exclamation marks', () => {
  for (const [name, e] of Object.entries(emails)) {
    for (const part of [e.subject, textOf(e.html), e.text]) {
      const clean = part.replace(/no newsletters, no offers/g, '');
      for (const re of DENY) assert.doesNotMatch(clean, re, `${name}: ${re}`);
    }
  }
});

test('each email says why it arrived and points to the privacy notice; the welcome is signed', () => {
  assert.match(emails.welcome.text, /Marco Azarmaneche, who runs CloudTrain/);
  for (const [name, e] of Object.entries(emails)) {
    for (const part of [textOf(e.html), e.text]) {
      assert.match(part, /Privacy notice/, `${name}: privacy notice`);
      assert.match(part, /waitlist|privacy request/, `${name}: reason`);
    }
  }
  assert.match(emails.welcome.text, /This address was added to the CloudTrain early-access waitlist/);
  assert.match(emails.welcome.text, /Until then you may get an occasional update about your entry/);
});

test('the html and text parts tell the same story', () => {
  for (const [name, e] of Object.entries(emails)) {
    const words = (s) => new Set(s.toLowerCase().match(/[a-z’']{5,}/g));
    const h = words(textOf(e.html));
    const t = words(e.text);
    const missing = [...h].filter((w) => !t.has(w));
    assert.deepEqual(missing, [], `${name}: words in html but not in text`);
  }
});
