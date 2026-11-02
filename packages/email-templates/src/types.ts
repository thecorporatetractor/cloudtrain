/** What every render function returns: the parts of one message, ready for a mailer. */
export interface RenderedEmail {
  subject: string;
  /** The HTML part, self-contained; the only external resource is the wordmark PNG on the site. */
  html: string;
  /** The plain-text part, written by hand, with every link in full. */
  text: string;
}
