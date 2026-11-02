/*
 * @cloudtrain/email-templates: the transactional emails, as pure functions of
 * their few dynamic values. Each returns { subject, html, text }; every value
 * is escaped, every link checked to be an absolute http(s) URL. The HTML is
 * self-contained apart from the wordmark PNG served by the site; there are no
 * tracking pixels, remote stylesheets or click-wrapped links, and the copy is
 * notification only (see test/copy.test.mjs for the denylist that keeps it so).
 */

export type { RenderedEmail } from './types.js';
export { renderWaitlistWelcome, type WaitlistWelcomeInput } from './waitlistWelcome.js';
export { renderPrivacyConfirm, type PrivacyConfirmInput, type PrivacyRequestType } from './privacyConfirm.js';
export { renderWaitlistLeft, type WaitlistLeftInput } from './waitlistLeft.js';
export { LOGO, LOGO_PATH } from './layout.js';
