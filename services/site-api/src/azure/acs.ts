import { EmailClient } from '@azure/communication-email';
import type { TokenCredential } from '@azure/identity';
import type { MailMessage, Mailer } from '../mailer.js';

/** ACS Email, authenticated with a managed identity: no connection string, no key. */
export class AcsMailer implements Mailer {
  private readonly client: EmailClient;

  constructor(
    endpoint: string,
    credential: TokenCredential,
    private readonly sender: string,
    private readonly replyTo: string,
  ) {
    this.client = new EmailClient(endpoint, credential);
  }

  async send(m: MailMessage): Promise<void> {
    let result;
    try {
      const poller = await this.client.beginSend({
        senderAddress: this.sender,
        recipients: { to: [{ address: m.to }] },
        content: { subject: m.subject, plainText: m.text, ...(m.html ? { html: m.html } : {}) },
        replyTo: [{ address: this.replyTo }],
        // No open or click tracking, whatever the resource's defaults are.
        disableUserEngagementTracking: true,
      });
      result = await poller.pollUntilDone();
    } catch (e) {
      throw new Error(providerFailure(e));
    }
    // The provider's error object can repeat the recipient: only the status goes on.
    if (result.status !== 'Succeeded') throw new Error(`mail: provider status ${result.status}`);
  }
}

/** What the provider said, for the logs: its code and request id. Its message can repeat the recipient, so it stays out. */
export function providerFailure(e: unknown): string {
  const err = e as { code?: unknown; statusCode?: unknown; request?: { requestId?: unknown }; response?: { headers?: { get?: (n: string) => string | undefined } } };
  const headers = err?.response?.headers;
  const requestId = headers?.get?.('x-ms-request-id') ?? headers?.get?.('x-ms-client-request-id') ?? err?.request?.requestId;
  return `mail: provider refused (code ${String(err?.code ?? 'unknown')}, status ${String(err?.statusCode ?? 'unknown')}, request ${String(requestId ?? 'unknown')})`;
}
