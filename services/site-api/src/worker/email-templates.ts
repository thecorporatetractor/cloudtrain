export { renderPrivacyConfirm, renderWaitlistLeft, renderWaitlistWelcome } from '@cloudtrain/email-templates';

/** A message to send: the templates always have html; the plain completion notices do not. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html?: string;
}
