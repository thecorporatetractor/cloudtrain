import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(m: Mail): Promise<void>;
}

/** SMTP (Mailpit on 127.0.0.1:1025 in dev). */
export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(
    host: string,
    port: number,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({ host, port, secure: false, ignoreTLS: port === 1025 });
  }
  async send(m: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...m });
  }
}

/** Tests: keeps what would have been sent. */
export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  async send(m: Mail): Promise<void> {
    this.sent.push(m);
  }
}
