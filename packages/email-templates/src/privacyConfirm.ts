import { BRAND, button, h1, p, page, plainUrl, terminal, textBody, textFooter } from './layout.js';
import { checkUrl, esc, site } from './values.js';
import type { RenderedEmail } from './types.js';

export type PrivacyRequestType = 'erasure' | 'withdrawal' | 'export';

export interface PrivacyConfirmInput {
  siteUrl: string;
  /** The one-use confirmation link (the token travels in its fragment). */
  confirmUrl: string;
  type: PrivacyRequestType;
}

const REQUEST: Record<PrivacyRequestType, { subject: string; what: string; type: string; effect: string }> = {
  erasure: {
    subject: 'erase your waitlist entry',
    what: 'erase the waitlist entry held under this address',
    type: 'erasure',
    effect: 'the waitlist entry is deleted',
  },
  withdrawal: {
    subject: 'withdraw your consent',
    what: 'withdraw the consent under which the waitlist entry for this address is held, which removes the entry',
    type: 'withdrawal of consent',
    effect: 'the waitlist entry is deleted',
  },
  export: {
    subject: 'get a copy of your data',
    what: 'see a copy of what the waitlist holds under this address',
    type: 'copy of your data',
    effect: 'you see what the waitlist holds',
  },
};

/**
 * "Confirm this request": the link that proves the address is the requester's
 * (apps/web/src/lib/privacyRequest.ts explains the flow). Works once, expires
 * 24 hours after the request. Someone who did not ask ignores it and nothing
 * changes.
 */
export function renderPrivacyConfirm(input: PrivacyConfirmInput): RenderedEmail {
  const s = site(input.siteUrl);
  const confirmUrl = checkUrl('confirmUrl', input.confirmUrl);
  const r = REQUEST[input.type];
  if (!r || !Object.prototype.hasOwnProperty.call(REQUEST, input.type)) throw new RangeError(`type: expected erasure, withdrawal or export, got ${JSON.stringify(input.type)}`);
  const subject = `Confirm your ${BRAND} privacy request: ${r.subject}`;

  const html = page({
    site: s,
    title: subject,
    preheader: 'Open the link to confirm. It works once and expires 24 hours after the request.',
    body: [
      h1('Confirm your privacy request'),
      p(`Someone, probably you, asked us at ${esc(s.host)} to ${esc(r.what)}. Nothing happens until the request is confirmed from this mailbox.`),
      terminal('privacy', s.host, 'ct privacy request', [
        { k: 'type', v: r.type },
        { k: 'scope', v: 'waitlist entry for this address' },
        { k: 'on confirm', v: r.effect },
        { k: 'link', v: 'one use, valid 24 h', tone: 'muted' },
      ]),
      p(`If that was you, confirm it here. The link works once and expires 24 hours after the request.`),
      button(confirmUrl, 'Confirm the request'),
      p('Or open this address in your browser:', { muted: true }),
      plainUrl(confirmUrl),
      p(`If it wasn’t you, ignore this message. The request expires on its own and nothing changes.`, { last: true }),
    ].join('\n'),
  });

  const text = textBody(
    'CONFIRM YOUR PRIVACY REQUEST',
    `Someone, probably you, asked us at ${s.host} to ${r.what}. Nothing happens until the request is confirmed from this mailbox.`,
    ['$ ct privacy request', `type        ${r.type}`, 'scope       waitlist entry for this address', `on confirm  ${r.effect}`, 'link        one use, valid 24 h'].join('\n'),
    `If that was you, open this link in your browser to confirm. It works once and expires 24 hours after the request:\n${confirmUrl}`,
    `If it wasn’t you, ignore this message. The request expires on its own and nothing changes.`,
    '--',
    textFooter(s.origin),
  );

  return { subject, html, text };
}
