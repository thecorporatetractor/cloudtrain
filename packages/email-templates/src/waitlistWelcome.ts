import { BRAND, OWNER, h1, h2, leaveBlock, link, p, page, terminal, textBody, textFooter } from './layout.js';
import { checkUrl, esc, site } from './values.js';
import type { RenderedEmail } from './types.js';

export interface WaitlistWelcomeInput {
  /** The public site origin, `https://cloudtrain.app`. */
  siteUrl: string;
  /** The link that removes this address from the waitlist, no login. */
  leaveUrl: string;
}

/**
 * "You're on the waitlist": sent once, right after the signup. A notification,
 * never marketing: what happened, what comes next, how to leave. It does not
 * promise a date, a place in a queue or a price, and it says who sends it,
 * because the signup had no email verification and the reader may not have
 * been the one who typed the address.
 */
export function renderWaitlistWelcome(input: WaitlistWelcomeInput): RenderedEmail {
  const s = site(input.siteUrl);
  const leaveUrl = checkUrl('leaveUrl', input.leaveUrl);
  const privacy = `${s.origin}/legal/privacy`;
  const subject = `You’re on the ${BRAND} waitlist`;

  const html = page({
    site: s,
    title: subject,
    preheader: 'Your early-access entry is recorded. Nothing to do now.',
    body: [
      h1('You’re on the waitlist'),
      p(`This address was added to the ${BRAND} early-access waitlist at ${link(s.origin, s.host)}, and this message confirms it. There is nothing you need to do.`),
      terminal('waitlist', s.host, 'ct waitlist status', [
        { k: 'status', v: 'on the waitlist', tone: 'ok' },
        { k: 'place', v: 'not open yet' },
        { k: 'next', v: 'a message when it opens' },
      ]),
      h2('What happens next'),
      p(`${BRAND} is in private beta. When your place opens we email you. Until then you may get an occasional update about your entry, and nothing else: no newsletters, no offers.`),
      p(`We keep your email address, the optional details you gave and the time you agreed to the ${link(privacy, 'privacy notice')}, only to contact you about early access and to plan access. You can have the entry deleted at any time.`, { muted: true }),
      p(`&mdash; ${esc(OWNER)}, who runs ${BRAND}`),
      leaveBlock(leaveUrl),
    ].join('\n'),
  });

  const text = textBody(
    'YOU’RE ON THE WAITLIST',
    `This address was added to the ${BRAND} early-access waitlist at ${s.host}, and this message confirms it. There is nothing you need to do.`,
    ['$ ct waitlist status', 'status   on the waitlist', 'place    not open yet', 'next     a message when it opens'].join('\n'),
    'WHAT HAPPENS NEXT',
    `${BRAND} is in private beta. When your place opens we email you. Until then you may get an occasional update about your entry, and nothing else: no newsletters, no offers.`,
    `We keep your email address, the optional details you gave and the time you agreed to the privacy notice (${privacy}), only to contact you about early access and to plan access. You can have the entry deleted at any time.`,
    `— ${OWNER}, who runs ${BRAND}`,
    `Don’t want these messages? Leave the waitlist. Your entry is deleted:\n${leaveUrl}`,
    `If this wasn’t you, someone entered your address by mistake. The same link removes it.`,
    '--',
    textFooter(s.origin),
  );

  return { subject, html, text };
}
