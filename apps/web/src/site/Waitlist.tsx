import { useMutation } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SiteConfig, SiteWaitlist, WaitlistInterest } from '@/api/types';
import { emptyWaitlistForm, fieldOn, submitWaitlist, validateWaitlistForm, waitlistPayload, WaitlistError, type WaitlistErrors, type WaitlistField, type WaitlistForm } from '@/lib/waitlist';

/*
 * The early-access waitlist section of the landing page (#waitlist). Copy and
 * fields come from content/site.yaml `waitlist`; the form posts to the gateway's
 * POST /api/public/waitlist (the API origin of runtime-config.js, so a static
 * deployment can host the page elsewhere). The consent checkbox opens the privacy
 * page in a new tab so a half-filled form is not lost.
 */

export type WaitlistPhase = 'idle' | 'submitting' | 'created' | 'duplicate' | 'error';

const D = {
  eyebrow: 'Early access',
  title: 'Join the early-access waitlist',
  body: 'Tell us where you are and we will reach out when your place opens.',
  submitLabel: 'Join the waitlist',
  emailLabel: 'Email address',
  consentLabel: 'I agree that these details may be stored to contact me about early access. See the',
  privacyLinkLabel: 'privacy notice',
  successTitle: 'You are on the list',
  successBody: 'Thank you. We will be in touch when early access opens for you.',
  duplicateTitle: 'You are already on the list',
  duplicateBody: 'This address is already registered, so there is nothing more to do.',
  errorMessage: 'We could not save your details just now. Please try again in a few minutes.',
};

export interface WaitlistViewProps {
  cfg: SiteWaitlist;
  values: WaitlistForm;
  errors: WaitlistErrors;
  phase: WaitlistPhase;
  /** A message above the button: a rate limit or a failure that is not tied to one field. */
  formError?: string;
  onChange: (patch: Partial<WaitlistForm>) => void;
  onSubmit: () => void;
  onReset?: () => void;
}

/** Presentational: everything the visitor sees, driven by props (so it renders the same on the server for tests). */
export function WaitlistView({ cfg, values, errors, phase, formError, onChange, onSubmit, onReset }: WaitlistViewProps) {
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const statusRef = useRef<HTMLDivElement>(null);
  const done = phase === 'created' || phase === 'duplicate';
  useEffect(() => {
    if (done) statusRef.current?.focus();
  }, [done]);
  const f = cfg.fields ?? {};
  const busy = phase === 'submitting';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onSubmit();
  };
  const err = (k: WaitlistField) => errors[k];
  const aria = (k: WaitlistField, hint?: string) => ({
    'aria-invalid': err(k) ? (true as const) : undefined,
    'aria-describedby': [err(k) ? id(`${k}-err`) : '', hint ?? ''].filter(Boolean).join(' ') || undefined,
  });
  const Error_ = ({ k }: { k: WaitlistField }) =>
    err(k) ? (
      <p id={id(`${k}-err`)} className="site-wl-error">
        {err(k)}
      </p>
    ) : null;

  return (
    <div className="site-wl">
      <div className="site-wl-copy">
        <div className="site-eyebrow">{cfg.eyebrow ?? D.eyebrow}</div>
        <h2 id="waitlist-title" className="site-h2">
          {cfg.title ?? D.title}
        </h2>
        <p className="site-section-lead">{cfg.body ?? D.body}</p>
        {cfg.note && <p className="site-wl-note">{cfg.note}</p>}
      </div>

      <div className="site-wl-card">
        {done ? (
          <div ref={statusRef} role="status" tabIndex={-1} className="site-wl-done" data-state={phase}>
            <CheckCircle2 size={22} aria-hidden className="site-wl-done-icon" />
            <h3 className="site-h3">{phase === 'created' ? (cfg.successTitle ?? D.successTitle) : (cfg.duplicateTitle ?? D.duplicateTitle)}</h3>
            <p className="muted">{phase === 'created' ? (cfg.successBody ?? D.successBody) : (cfg.duplicateBody ?? D.duplicateBody)}</p>
            {onReset && (
              <button type="button" className="btn btn-secondary btn-md" onClick={onReset}>
                Use another address
              </button>
            )}
          </div>
        ) : (
          <form className="site-wl-form" onSubmit={submit} noValidate aria-labelledby="waitlist-title">
            {(formError || phase === 'error') && (
              <p role="alert" className="site-wl-alert">
                {formError ?? cfg.errorMessage ?? D.errorMessage}
              </p>
            )}

            <div className="site-wl-field">
              <label htmlFor={id('email')}>
                {cfg.emailLabel ?? D.emailLabel} <span className="site-wl-req">(required)</span>
              </label>
              <input id={id('email')} name="email" type="email" inputMode="email" autoComplete="email" required className="input site-wl-input" value={values.email} onChange={(e) => onChange({ email: e.target.value })} {...aria('email')} />
              <Error_ k="email" />
            </div>

            {fieldOn(cfg, 'organisation') && (
              <div className="site-wl-field">
                <label htmlFor={id('organisation')}>
                  {f.organisation?.label ?? 'Organisation'} {!f.organisation?.required && <span className="site-wl-opt">(optional)</span>}
                </label>
                <input id={id('organisation')} name="organisation" type="text" autoComplete="organization" maxLength={120} required={!!f.organisation?.required} placeholder={f.organisation?.placeholder} className="input site-wl-input" value={values.organisation} onChange={(e) => onChange({ organisation: e.target.value })} {...aria('organisation')} />
                <Error_ k="organisation" />
              </div>
            )}

            {fieldOn(cfg, 'role') && (
              <div className="site-wl-field">
                <label htmlFor={id('role')}>
                  {f.role?.label ?? 'Role'} {!f.role?.required && <span className="site-wl-opt">(optional)</span>}
                </label>
                {f.role?.options?.length ? (
                  <select id={id('role')} name="role" required={!!f.role.required} className="input site-wl-input" value={values.role} onChange={(e) => onChange({ role: e.target.value })} {...aria('role')}>
                    <option value="">Select a role</option>
                    {f.role.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id={id('role')} name="role" type="text" autoComplete="organization-title" maxLength={80} required={!!f.role?.required} placeholder={f.role?.placeholder} className="input site-wl-input" value={values.role} onChange={(e) => onChange({ role: e.target.value })} {...aria('role')} />
                )}
                <Error_ k="role" />
              </div>
            )}

            {fieldOn(cfg, 'interest') && (
              <fieldset role="radiogroup" className="site-wl-field site-wl-radios" {...aria('interest')}>
                <legend>
                  {f.interest?.label ?? 'I am interested as'} {!f.interest?.required && <span className="site-wl-opt">(optional)</span>}
                </legend>
                {(
                  [
                    ['enterprise', f.interest?.enterpriseLabel ?? 'An organisation or team'],
                    ['individual', f.interest?.individualLabel ?? 'An individual learner'],
                  ] as [WaitlistInterest, string][]
                ).map(([v, label]) => (
                  <label key={v} className="site-wl-radio">
                    <input type="radio" name="interest" value={v} checked={values.interest === v} onChange={() => onChange({ interest: v })} />
                    <span>{label}</span>
                  </label>
                ))}
                <Error_ k="interest" />
              </fieldset>
            )}

            {/* Honeypot: off-screen, out of the tab order and hidden from assistive technology. People never fill it. */}
            <div className="site-wl-hp" aria-hidden="true">
              <label htmlFor={id('website')}>Website, leave this empty</label>
              <input id={id('website')} name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => onChange({ website: e.target.value })} />
            </div>

            <div className="site-wl-field">
              <label className="site-wl-consent">
                <input type="checkbox" name="consent" required checked={values.consent} onChange={(e) => onChange({ consent: e.target.checked })} {...aria('consent')} />
                <span>
                  {cfg.consentLabel ?? D.consentLabel}{' '}
                  <a href="/legal/privacy" target="_blank" rel="noopener">
                    {cfg.privacyLinkLabel ?? D.privacyLinkLabel}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  .
                </span>
              </label>
              <Error_ k="consent" />
            </div>

            <button type="submit" className="btn btn-primary btn-xl site-wl-submit" disabled={busy} aria-disabled={busy}>
              {busy ? <Loader2 size={16} aria-hidden className="spin" /> : null}
              {busy ? 'Sending' : (cfg.submitLabel ?? D.submitLabel)}
              {!busy && <ArrowRight size={16} aria-hidden />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** The stateful form: validates, posts, and maps the gateway's answers to the view. */
export function WaitlistPanel({ cfg }: { cfg: SiteWaitlist }) {
  const [values, setValues] = useState<WaitlistForm>(emptyWaitlistForm);
  const [errors, setErrors] = useState<WaitlistErrors>({});
  const [formError, setFormError] = useState<string>();
  const [phase, setPhase] = useState<WaitlistPhase>('idle');
  const send = useMutation({ mutationFn: (v: WaitlistForm) => submitWaitlist(waitlistPayload(v, cfg)) });

  const onSubmit = () => {
    const found = validateWaitlistForm(values, cfg);
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length) {
      // Move to the first invalid control so the message is announced next to it.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.site-wl-form [aria-invalid="true"]')?.focus());
      return;
    }
    setPhase('submitting');
    send.mutate(values, {
      onSuccess: (r) => setPhase(r.status),
      onError: (e) => {
        setPhase('idle');
        if (e instanceof WaitlistError && e.kind === 'invalid') {
          setErrors(e.fields);
          requestAnimationFrame(() => document.querySelector<HTMLElement>('.site-wl-form [aria-invalid="true"]')?.focus());
        } else if (e instanceof WaitlistError && e.kind === 'rate_limited') {
          const mins = e.retryAfterSeconds ? Math.max(1, Math.ceil(e.retryAfterSeconds / 60)) : undefined;
          setFormError(`Too many attempts from this connection.${mins ? ` Please try again in about ${mins} minute${mins === 1 ? '' : 's'}.` : ' Please try again later.'}`);
        } else {
          setPhase('error');
        }
      },
    });
  };

  return (
    <WaitlistView
      cfg={cfg}
      values={values}
      errors={errors}
      phase={phase}
      {...(formError ? { formError } : {})}
      onChange={(patch) => {
        setValues((v) => ({ ...v, ...patch }));
        const cleared = Object.keys(patch).filter((k) => k in errors);
        if (cleared.length) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !cleared.includes(k))));
      }}
      onSubmit={onSubmit}
      onReset={() => {
        setValues(emptyWaitlistForm);
        setErrors({});
        setPhase('idle');
      }}
    />
  );
}

/** The landing page section; nothing at all when the waitlist is off. */
export function WaitlistSection({ site }: { site: SiteConfig }) {
  const cfg = site.waitlist;
  if (!cfg?.enabled) return null;
  return (
    <section id="waitlist" className="site-section site-section-alt" aria-labelledby="waitlist-title">
      <div className="site-container">
        <WaitlistPanel cfg={cfg} />
      </div>
    </section>
  );
}
