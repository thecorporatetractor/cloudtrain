import { BRAND, h1, link, p, page, terminal, textBody, textFooter } from './layout.js';
import { site } from './values.js';
import type { RenderedEmail } from './types.js';

export interface WaitlistLeftInput {
  siteUrl: string;
}

/**
 * "You've left the waitlist": the last message, sent after the entry is
 * deleted. It confirms the deletion and says what remains, nothing more.
 */
export function renderWaitlistLeft(input: WaitlistLeftInput): RenderedEmail {
  const s = site(input.siteUrl);
  const privacy = `${s.origin}/legal/privacy`;
  const subject = `You’ve left the ${BRAND} waitlist`;

  const html = page({
    site: s,
    title: subject,
    preheader: 'Your entry is deleted. This is the last message about it.',
    body: [
      h1('You’ve left the waitlist'),
      p(`Your entry on the ${BRAND} early-access waitlist has been deleted. There will be no more messages about it; this is the last one.`),
      terminal('waitlist', s.host, 'ct waitlist status', [
        { k: 'status', v: 'not on the waitlist' },
        { k: 'entry', v: 'deleted', tone: 'ok' },
        { k: 'next', v: 'nothing' },
      ]),
      p(`The ${link(privacy, 'privacy notice')} describes what we keep after a deletion. If this was a mistake, you can join again at ${link(s.origin, s.host)}.`, { last: true }),
    ].join('\n'),
  });

  const text = textBody(
    'YOU’VE LEFT THE WAITLIST',
    `Your entry on the ${BRAND} early-access waitlist has been deleted. There will be no more messages about it; this is the last one.`,
    ['$ ct waitlist status', 'status   not on the waitlist', 'entry    deleted', 'next     nothing'].join('\n'),
    `The privacy notice (${privacy}) describes what we keep after a deletion. If this was a mistake, you can join again at ${s.origin}.`,
    '--',
    textFooter(s.origin),
  );

  return { subject, html, text };
}
