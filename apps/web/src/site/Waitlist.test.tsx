import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { SiteConfig } from '@/api/types';
import siteYaml from '../../../../content/site.yaml?raw';
import { emptyWaitlistForm } from '@/lib/waitlist';
import { WaitlistSection, WaitlistView, type WaitlistViewProps } from './Waitlist';

const site = parse(siteYaml) as SiteConfig;
const cfg = site.waitlist!;
const noop = () => undefined;
/** The opening tag of the first `<tag>` that carries `attr` (React does not keep attribute order). */
const tag = (html: string, name: string, attr: string): string => html.match(new RegExp(`<${name}\\b[^>]*${attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`))?.[0] ?? '';
const withQuery = (el: ReactElement) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
const view = (p: Partial<WaitlistViewProps> = {}) => renderToStaticMarkup(<WaitlistView cfg={cfg} values={emptyWaitlistForm} errors={{}} phase="idle" onChange={noop} onSubmit={noop} {...p} />);

describe('waitlist section', () => {
  it('renders nothing when the waitlist is off or absent', () => {
    expect(withQuery(<WaitlistSection site={{ ...site, waitlist: { ...cfg, enabled: false } }} />)).toBe('');
    const { waitlist: _w, ...without } = site;
    expect(withQuery(<WaitlistSection site={without as SiteConfig} />)).toBe('');
  });

  it('renders the anchored, labelled section from the configuration', () => {
    const html = withQuery(<WaitlistSection site={site} />);
    expect(html).toContain('id="waitlist"');
    expect(html).toContain('aria-labelledby="waitlist-title"');
    expect(html).toContain(cfg.title!);
    expect(html).toContain(cfg.submitLabel!);
  });
});

describe('waitlist form markup', () => {
  it('labels every control and marks the email required', () => {
    const html = view();
    expect(html).toMatch(/<label for="[^"]+-email">/);
    const email = tag(html, 'input', 'name="email"');
    expect(email).toContain('type="email"');
    expect(email).toContain('required=""');
    expect(email).toMatch(/id="([^"]+-email)"/);
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend>');
    expect((html.match(/type="radio"/g) ?? []).length).toBe(2);
    expect(html).toContain('<select');
    for (const o of cfg.fields!.role!.options!) expect(html).toContain(`>${o}</option>`);
    expect(html).toMatch(/novalidate/i);
  });

  it('links the consent checkbox to the privacy page in a new tab', () => {
    const html = view();
    const consent = tag(html, 'input', 'name="consent"');
    expect(consent).toContain('type="checkbox"');
    expect(consent).toContain('required=""');
    expect(html).toMatch(/<a href="\/legal\/privacy" target="_blank" rel="noopener">/);
    expect(html).toContain('(opens in a new tab)');
  });

  it('hides the honeypot from people and assistive technology', () => {
    const html = view();
    expect(html).toMatch(/<div class="site-wl-hp" aria-hidden="true">/);
    const hp = tag(html, 'input', 'name="website"');
    expect(hp).toMatch(/tabindex="-1"/i);
    expect(hp).toMatch(/autocomplete="off"/i);
  });

  it('drops disabled fields and renders free-text role when there are no options', () => {
    const html = view({ cfg: { ...cfg, fields: { organisation: { enabled: false }, interest: { enabled: false }, role: {} } } });
    expect(html).not.toContain('name="organisation"');
    expect(html).not.toContain('type="radio"');
    expect(tag(html, 'input', 'name="role"')).toContain('type="text"');
    expect(html).not.toContain('<select');
  });

  it('shows field errors tied to their control with aria-invalid and aria-describedby', () => {
    const html = view({ errors: { email: 'Enter a valid email address', consent: 'Agree first' } });
    expect(html).toMatch(/aria-invalid="true" aria-describedby="[^"]+-email-err"|aria-describedby="[^"]+-email-err" aria-invalid="true"/);
    expect(html).toMatch(/<p id="[^"]+-email-err" class="site-wl-error">Enter a valid email address<\/p>/);
    expect(html).toContain('Agree first');
  });

  it('announces a form-level failure and disables the button while sending', () => {
    expect(view({ phase: 'error' })).toMatch(/role="alert"[^>]*>We could not save/);
    expect(view({ phase: 'idle', formError: 'Too many attempts' })).toContain('Too many attempts');
    const busy = view({ phase: 'submitting' });
    expect(busy).toMatch(/<button type="submit"[^>]* disabled=""/);
    expect(busy).toContain('Sending');
  });

  it('shows the success state as a status region instead of the form', () => {
    const html = view({ phase: 'created', onReset: vi.fn() });
    expect(html).toMatch(/role="status"/);
    expect(html).toContain(cfg.successTitle!);
    expect(html).not.toContain('<form');
    expect(html).toContain('Use another address');
  });

  it('shows the duplicate state with its own copy', () => {
    const html = view({ phase: 'duplicate' });
    expect(html).toContain(cfg.duplicateTitle!);
    expect(html).toContain(cfg.duplicateBody!);
    expect(html).toContain('data-state="duplicate"');
    expect(html).not.toContain('<form');
  });
});
