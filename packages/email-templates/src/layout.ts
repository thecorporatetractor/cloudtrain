/*
 * The one layout every CloudTrain email shares: the wordmark, a card with the
 * message, a footer with the contacts and the privacy notice. Built for mail clients, not
 * browsers: nested tables with role="presentation", every style inline, a
 * 600px column that Outlook's Word engine gets through a conditional table and
 * everyone else through max-width, no web fonts, no background images, no VML.
 *
 * Colours are the site's tokens (apps/web/src/styles/tokens.css) flattened to
 * opaque values. Light is the inline default; the <style> block switches to the
 * dark tokens under prefers-color-scheme and Outlook.com's [data-ogsc]. The
 * terminal block is dark in both modes, like the hero's lab window: a client
 * that force-inverts a light email turns it into the site's light terminal, and
 * a client that leaves it alone shows it as designed. The wordmark is a single
 * mid-grey PNG that reads on both backgrounds and survives an inversion, so no
 * client is ever left with an invisible logo.
 */

import { esc } from './values.js';

export const BRAND = 'CloudTrain';
export const OWNER = 'Marco Azarmaneche';
export const PRIVACY_EMAIL = 'gdpr@cloudtrain.app';
export const HELLO_EMAIL = 'hello@cloudtrain.app';
/** The wordmark, served by the site (apps/web/public/brand). 2x pixels, shown at 128x28. */
export const LOGO_PATH = '/brand/cloudtrain-email-logo.png';
export const LOGO = { width: 128, height: 28 } as const;

/* The tokens, light inline and dark through the stylesheet. */
const T = {
  bg: '#f6f6f7',
  surface: '#ffffff',
  border: '#e6e8eb',
  fg: '#17191c',
  muted: '#5c626a',
  accent: '#4b5468',
  accentFg: '#ffffff',
} as const;
const D = {
  bg: '#0e0f11',
  surface: '#141618',
  border: '#272a2e',
  fg: '#e6e8eb',
  muted: '#9aa0a8',
  accent: '#a9b4c9',
  accentFg: '#0e0f11',
} as const;
/* The terminal, dark in both modes (the site's dark theme terminal). */
const TERM = { bg: '#0b0c0e', bar: '#141618', border: '#2a2e33', fg: '#d7dadf', muted: '#9aa0a8', prompt: '#a9b4c9', ok: '#6dbb8b', dot: '#33383e' } as const;

export const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const TEXT = `font-family:${SANS};font-size:16px;line-height:24px;color:${T.fg};`;
const SMALL = `font-family:${SANS};font-size:14px;line-height:21px;color:${T.muted};`;

/* ----------------------------------------------------------------- pieces */

export function h1(text: string): string {
  return `<h1 class="em-fg" style="margin:0 0 16px;font-family:${SANS};font-size:24px;line-height:30px;font-weight:600;letter-spacing:-0.02em;color:${T.fg};">${esc(text)}</h1>`;
}

export function h2(text: string): string {
  return `<h2 class="em-muted" style="margin:28px 0 8px;font-family:${SANS};font-size:13px;line-height:18px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:${T.muted};">${esc(text)}</h2>`;
}

/** A paragraph. `html` is already-escaped markup (use `esc` and `link` for anything dynamic). */
export function p(html: string, opts: { muted?: boolean; last?: boolean } = {}): string {
  const base = opts.muted ? SMALL : TEXT;
  return `<p class="${opts.muted ? 'em-muted' : 'em-fg'}" style="margin:0 0 ${opts.last ? 0 : 16}px;${base}">${html}</p>`;
}

/** An inline link. `href` must have passed checkUrl; `text` is escaped here. */
export function link(href: string, text: string): string {
  return `<a class="em-link" href="${esc(href)}" style="color:${T.accent};text-decoration:underline;text-underline-offset:2px;">${esc(text)}</a>`;
}

/** The one call to action: a table cell with the colour, a block link with the padding, 44px tall. No VML, Outlook paints the cell. */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 16px;">
<tr><td class="em-btn" bgcolor="${T.accent}" style="border-radius:8px;background-color:${T.accent};">
<a class="em-btn-a" href="${esc(href)}" style="display:block;padding:12px 24px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:600;color:${T.accentFg};text-decoration:none;border-radius:8px;">${esc(label)}</a>
</td></tr>
</table>`;
}

/** The full link as text, for people who do not trust buttons. Breaks anywhere so it never widens the column. */
export function plainUrl(href: string): string {
  return `<p class="em-muted" style="margin:0 0 16px;${SMALL}word-break:break-all;overflow-wrap:anywhere;"><a class="em-link" href="${esc(href)}" style="color:${T.accent};text-decoration:underline;">${esc(href)}</a></p>`;
}

export type Tone = 'fg' | 'muted' | 'ok';
export interface TerminalRow {
  k: string;
  v: string;
  tone?: Tone;
}

/**
 * The status block: the lab window of the site in miniature. A bar with three
 * dots and a title, a command line, then key/value rows. Status, never a pitch.
 */
export function terminal(title: string, host: string, command: string, rows: TerminalRow[]): string {
  const tone = (t: Tone = 'fg') => (t === 'ok' ? TERM.ok : t === 'muted' ? TERM.muted : TERM.fg);
  const body = rows
    .map(
      (r) =>
        `<tr><td style="padding:2px 16px 2px 0;font-family:${MONO};font-size:13px;line-height:20px;color:${TERM.muted};white-space:nowrap;vertical-align:top;">${esc(r.k)}</td>` +
        `<td style="padding:2px 0;font-family:${MONO};font-size:13px;line-height:20px;color:${tone(r.tone)};vertical-align:top;">${esc(r.v)}</td></tr>`,
    )
    .join('\n');
  const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:9px;background-color:${TERM.dot};margin-right:6px;">&nbsp;</span>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-term" style="margin:24px 0;border:1px solid ${TERM.border};border-radius:10px;border-collapse:separate;background-color:${TERM.bg};">
<tr><td class="em-term-bar" bgcolor="${TERM.bar}" style="padding:9px 14px;border-bottom:1px solid ${TERM.border};background-color:${TERM.bar};border-radius:10px 10px 0 0;font-family:${SANS};font-size:13px;line-height:18px;color:${TERM.muted};">
<span style="font-size:1px;line-height:9px;">${dot}${dot}${dot}</span>&nbsp;&nbsp;<span style="color:${TERM.fg};font-weight:600;">${esc(title)}</span> &middot; ${esc(host)}
</td></tr>
<tr><td bgcolor="${TERM.bg}" style="padding:14px 16px 16px;background-color:${TERM.bg};border-radius:0 0 10px 10px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr><td colspan="2" style="padding:0 0 6px;font-family:${MONO};font-size:13px;line-height:20px;color:${TERM.fg};"><span style="color:${TERM.prompt};">$</span> ${esc(command)}</td></tr>
${body}
</table>
</td></tr>
</table>`;
}

/**
 * The way out of the waitlist. Body-sized text in the foreground colour, a
 * separate block above the footer: the reader must be able to find it without
 * looking.
 */
export function leaveBlock(leaveUrl: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
<tr><td class="em-rule" style="border-top:1px solid ${T.border};padding:20px 0 0;">
${p(`Don’t want these messages? ${link(leaveUrl, 'Leave the waitlist')}. Your entry is deleted.`)}
${p(`If this wasn’t you, someone entered your address by mistake. The same link removes it.`, { muted: true, last: true })}
</td></tr>
</table>`;
}

/* ----------------------------------------------------------------- page */

export interface PageInput {
  /** The site origin (checked, no trailing slash) and host, from `site()`. */
  site: { origin: string; host: string };
  /** The <title>; the subject usually. */
  title: string;
  /** The hidden preview line clients show next to the subject. */
  preheader: string;
  /** The card's content, built from the pieces above. */
  body: string;
}

const STYLE = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
a{color:${T.accent};}
@media only screen and (max-width:480px){
.em-outer{padding:20px 12px 28px !important;}
.em-card{padding:24px 20px !important;}
.em-head{padding:0 0 16px !important;}
.em-foot{padding:20px 4px 0 !important;}
}
@media (prefers-color-scheme:dark){
.em-body,.em-bg{background-color:${D.bg} !important;}
.em-card{background-color:${D.surface} !important;border-color:${D.border} !important;}
.em-rule{border-color:${D.border} !important;}
.em-fg{color:${D.fg} !important;}
.em-muted{color:${D.muted} !important;}
.em-link{color:${D.accent} !important;}
.em-btn{background-color:${D.accent} !important;}
.em-btn-a{color:${D.accentFg} !important;}
.em-logo{color:${D.fg} !important;}
}
[data-ogsc] .em-body,[data-ogsc] .em-bg{background-color:${D.bg} !important;}
[data-ogsc] .em-card{background-color:${D.surface} !important;border-color:${D.border} !important;}
[data-ogsc] .em-rule{border-color:${D.border} !important;}
[data-ogsc] .em-fg{color:${D.fg} !important;}
[data-ogsc] .em-muted{color:${D.muted} !important;}
[data-ogsc] .em-link{color:${D.accent} !important;}
[data-ogsc] .em-btn{background-color:${D.accent} !important;}
[data-ogsc] .em-btn-a{color:${D.accentFg} !important;}
[data-ogsc] .em-logo{color:${D.fg} !important;}
`.trim();

/** Keeps the preview line from running on into the body: a filler of invisible characters after the preheader. */
const PREHEADER_FILL = '&#847;&zwnj;&nbsp;'.repeat(60);

export function page(input: PageInput): string {
  const logo = `${input.site.origin}${LOGO_PATH}`;
  const privacy = `${input.site.origin}/legal/privacy`;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${esc(input.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
${STYLE}
</style>
</head>
<body class="em-body" style="margin:0;padding:0;background-color:${T.bg};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${T.bg};">${esc(input.preheader)}${PREHEADER_FILL}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-bg" bgcolor="${T.bg}" style="background-color:${T.bg};">
<tr><td align="center" class="em-outer" style="padding:32px 16px 40px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
<tr><td class="em-head" style="padding:0 4px 20px;">
<a href="${esc(input.site.origin)}" style="display:inline-block;text-decoration:none;"><img class="em-logo" src="${esc(logo)}" width="${LOGO.width}" height="${LOGO.height}" alt="${BRAND}" style="display:block;width:${LOGO.width}px;height:${LOGO.height}px;border:0;font-family:${SANS};font-size:18px;font-weight:600;color:${T.fg};"></a>
</td></tr>
<tr><td class="em-card" bgcolor="${T.surface}" style="padding:36px 40px;background-color:${T.surface};border:1px solid ${T.border};border-radius:12px;">
${input.body}
</td></tr>
<tr><td class="em-foot" style="padding:24px 4px 0;">
<p class="em-muted" style="margin:0 0 8px;${SMALL}font-size:13px;line-height:20px;">Privacy questions and requests: <a class="em-link" href="mailto:${PRIVACY_EMAIL}" style="color:${T.accent};text-decoration:underline;">${PRIVACY_EMAIL}</a>.</p>
<p class="em-muted" style="margin:0 0 8px;${SMALL}font-size:13px;line-height:20px;">Anything else: <a class="em-link" href="mailto:${HELLO_EMAIL}" style="color:${T.accent};text-decoration:underline;">${HELLO_EMAIL}</a>, or reply to this message.</p>
<p class="em-muted" style="margin:0;${SMALL}font-size:13px;line-height:20px;"><a class="em-link" href="${esc(privacy)}" style="color:${T.accent};text-decoration:underline;">Privacy notice</a> &middot; <a class="em-link" href="${esc(input.site.origin)}" style="color:${T.accent};text-decoration:underline;">${esc(input.site.host)}</a></p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

/* ----------------------------------------------------------------- text */

/** The plain-text footer, the same facts as the HTML one. */
export function textFooter(siteOrigin: string): string {
  return [`Privacy questions and requests: ${PRIVACY_EMAIL}.`, `Anything else: ${HELLO_EMAIL}, or reply to this message.`, `Privacy notice: ${siteOrigin}/legal/privacy`].join('\n');
}

/** Joins text blocks with blank lines and ends with one newline, as a text part should. */
export function textBody(...blocks: string[]): string {
  return blocks.join('\n\n') + '\n';
}
