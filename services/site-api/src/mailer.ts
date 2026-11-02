/*
 * Outgoing mail behind one interface: Azure Communication Services Email retires on 2028-09-30, so
 * the provider has to be replaceable without touching what the worker does. AcsMailer is in
 * azure/acs.ts.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  /** Resolves when the provider has accepted the message; rejects otherwise. */
  send(message: MailMessage): Promise<void>;
}
