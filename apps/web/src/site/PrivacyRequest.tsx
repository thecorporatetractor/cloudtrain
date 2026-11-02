import { useMutation } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { PrivacyConfirmResponse } from '@/api/types';
import { confirmPrivacyRequest, emptyPrivacyForm, PRIVACY_REQUEST_TYPES, privacyPayload, PrivacyError, resultMessage, submitPrivacyRequest, tokenFromHash, validatePrivacyForm, type PrivacyErrors, type PrivacyField, type PrivacyForm } from '@/lib/privacyRequest';
import { SitePage } from '@/routes/site/Pages';

/*
 * /legal/privacy-request: data-subject requests for people without an account (the waitlist).
 * Same form idioms as the waitlist. The link in the mail lands here with the token in the
 * fragment; nothing happens until the visitor presses the button, because mail scanners
 * open links on their own and must not be able to erase anything.
 */

export type RequestPhase = 'idle' | 'submitting' | 'accepted';

const rateMessage = (e: PrivacyError) => {
  const mins = e.retryAfterSeconds ? Math.max(1, Math.ceil(e.retryAfterSeconds / 60)) : undefined;
  return `Too many attempts from this connection.${mins ? ` Please try again in about ${mins} minute${mins === 1 ? '' : 's'}.` : ' Please try again later.'}`;
};

export interface PrivacyRequestViewProps {
  values: PrivacyForm;
  errors: PrivacyErrors;
  phase: RequestPhase;
  acceptedMessage?: string;
  formError?: string;
  onChange: (patch: Partial<PrivacyForm>) => void;
  onSubmit: () => void;
}

/** Presentational, so it renders the same on the server for tests. */
export function PrivacyRequestView({ values, errors, phase, acceptedMessage, formError, onChange, onSubmit }: PrivacyRequestViewProps) {
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const statusRef = useRef<HTMLDivElement>(null);
  const busy = phase === 'submitting';
  useEffect(() => {
    if (phase === 'accepted') statusRef.current?.focus();
  }, [phase]);
  const aria = (k: PrivacyField) => ({ 'aria-invalid': errors[k] ? (true as const) : undefined, 'aria-describedby': errors[k] ? id(`${k}-err`) : undefined });
  const fieldError = (k: PrivacyField) =>
    errors[k] ? (
      <p id={id(`${k}-err`)} className="site-wl-error">
        {errors[k]}
      </p>
    ) : null;

  if (phase === 'accepted') {
    return (
      <div className="site-wl-card">
        <div ref={statusRef} role="status" tabIndex={-1} className="site-wl-done" data-state="created">
          <CheckCircle2 size={22} aria-hidden className="site-wl-done-icon" />
          <h2 className="site-h3">Check your email</h2>
          <p className="muted">{acceptedMessage}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="site-wl-card">
      <form method="post"
        className="site-wl-form"
        noValidate
        aria-label="Privacy request"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        {formError && (
          <p role="alert" className="site-wl-alert">
            {formError}
          </p>
        )}
        <fieldset role="radiogroup" className="site-wl-field site-wl-radios" {...aria('type')}>
          <legend>
            What would you like us to do? <span className="site-wl-req">(required)</span>
          </legend>
          {PRIVACY_REQUEST_TYPES.map((t) => (
            <label key={t.value} className="site-wl-radio">
              <input type="radio" name="type" value={t.value} checked={values.type === t.value} onChange={() => onChange({ type: t.value })} />
              <span>
                {t.label}
                <span className="xs subtle privacy-hint">{t.hint}</span>
              </span>
            </label>
          ))}
          {fieldError('type')}
        </fieldset>

        <div className="site-wl-field">
          <label htmlFor={id('email')}>
            Email address <span className="site-wl-req">(required)</span>
          </label>
          <input id={id('email')} name="email" type="email" inputMode="email" autoComplete="email" required className="input site-wl-input" value={values.email} onChange={(e) => onChange({ email: e.target.value })} {...aria('email')} />
          {fieldError('email')}
        </div>

        {/* Honeypot: off-screen, out of the tab order and hidden from assistive technology. */}
        <div className="site-wl-hp" aria-hidden="true">
          <label htmlFor={id('website')}>Website, leave this empty</label>
          <input id={id('website')} name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => onChange({ website: e.target.value })} />
        </div>

        <button type="submit" className="btn btn-primary btn-xl site-wl-submit" disabled={busy} aria-disabled={busy}>
          {busy ? <Loader2 size={16} aria-hidden className="spin" /> : null}
          {busy ? 'Sending' : 'Email me a confirmation link'}
          {!busy && <ArrowRight size={16} aria-hidden />}
        </button>
      </form>
    </div>
  );
}

export interface PrivacyConfirmViewProps {
  phase: 'ready' | 'working' | 'done' | 'error';
  result?: PrivacyConfirmResponse;
  error?: string;
  canRetry?: boolean;
  onConfirm: () => void;
  onDownload?: () => void;
}

export function PrivacyConfirmView({ phase, result, error, canRetry, onConfirm, onDownload }: PrivacyConfirmViewProps) {
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === 'done') statusRef.current?.focus();
  }, [phase]);
  if (phase === 'done' && result) {
    const m = resultMessage(result);
    const rows = result.data?.waitlist ?? [];
    return (
      <div className="site-wl-card">
        <div ref={statusRef} role="status" tabIndex={-1} className="site-wl-done" data-state={result.status === 'pending' ? 'duplicate' : 'created'}>
          <CheckCircle2 size={22} aria-hidden className="site-wl-done-icon" />
          <h2 className="site-h3">{m.title}</h2>
          <p className="muted">{m.body}</p>
          {rows.map((r) => (
            <dl key={r.email} className="site-facts privacy-data">
              {[
                ['Email', r.email],
                ['Organisation', r.organisation],
                ['Role', r.role],
                ['Interested as', r.interest],
                ['Consent given', r.consentAt],
                ['Joined', r.createdAt],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="site-fact">
                    <dt className="xs subtle">{k}</dt>
                    <dd className="small">{v}</dd>
                  </div>
                ))}
            </dl>
          ))}
          {rows.length > 0 && onDownload && (
            <button type="button" className="btn btn-secondary btn-md" onClick={onDownload}>
              <Download size={14} aria-hidden /> Download as JSON
            </button>
          )}
        </div>
      </div>
    );
  }
  const working = phase === 'working';
  return (
    <div className="site-wl-card">
      <div className="site-wl-form">
        {error && (
          <p role="alert" className="site-wl-alert">
            {error}
          </p>
        )}
        {(phase !== 'error' || canRetry) && (
          <>
            <p>Press the button to carry out the request you asked for in your email. Erasing cannot be undone.</p>
            <button type="button" className="btn btn-primary btn-xl site-wl-submit" disabled={working} aria-disabled={working} onClick={onConfirm}>
              {working ? <Loader2 size={16} aria-hidden className="spin" /> : null}
              {working ? 'Working' : 'Confirm my request'}
            </button>
          </>
        )}
        {phase === 'error' && !canRetry && (
          <a className="btn btn-secondary btn-md" href="/legal/privacy-request">
            Send a new request
          </a>
        )}
      </div>
    </div>
  );
}

function RequestPanel() {
  const [values, setValues] = useState<PrivacyForm>(emptyPrivacyForm);
  const [errors, setErrors] = useState<PrivacyErrors>({});
  const [formError, setFormError] = useState<string>();
  const [phase, setPhase] = useState<RequestPhase>('idle');
  const [accepted, setAccepted] = useState<string>();
  const send = useMutation({ mutationFn: (v: PrivacyForm) => submitPrivacyRequest(privacyPayload(v)) });
  const focusInvalid = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('.site-wl-form [aria-invalid="true"]')?.focus());
  return (
    <PrivacyRequestView
      values={values}
      errors={errors}
      phase={phase}
      {...(accepted ? { acceptedMessage: accepted } : {})}
      {...(formError ? { formError } : {})}
      onChange={(patch) => {
        setValues((v) => ({ ...v, ...patch }));
        setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
      }}
      onSubmit={() => {
        const found = validatePrivacyForm(values);
        setErrors(found);
        setFormError(undefined);
        if (Object.keys(found).length) return void focusInvalid();
        setPhase('submitting');
        send.mutate(values, {
          onSuccess: (r) => {
            setAccepted(r.message);
            setPhase('accepted');
          },
          onError: (e) => {
            setPhase('idle');
            if (e instanceof PrivacyError && e.kind === 'invalid') {
              setErrors(e.fields);
              focusInvalid();
            } else if (e instanceof PrivacyError && e.kind === 'rate_limited') setFormError(rateMessage(e));
            else setFormError('We could not send your request just now. Please try again in a few minutes.');
          },
        });
      }}
    />
  );
}

function ConfirmPanel({ token }: { token: string }) {
  const [state, setState] = useState<Pick<PrivacyConfirmViewProps, 'phase' | 'result' | 'error' | 'canRetry'>>({ phase: 'ready' });
  const confirm = useMutation({ mutationFn: () => confirmPrivacyRequest(token) });
  return (
    <PrivacyConfirmView
      {...state}
      onConfirm={() => {
        setState({ phase: 'working' });
        confirm.mutate(undefined, {
          onSuccess: (result) => setState({ phase: 'done', result }),
          onError: (e) => {
            const kind = e instanceof PrivacyError ? e.kind : 'failed';
            if (kind === 'expired') setState({ phase: 'error', error: 'This link is invalid, has expired or was already used. You can send a new request.', canRetry: false });
            else if (kind === 'rate_limited') setState({ phase: 'error', error: rateMessage(e as PrivacyError), canRetry: true });
            else setState({ phase: 'error', error: 'We could not complete this just now. Please try again in a few minutes.', canRetry: true });
          },
        });
      }}
      onDownload={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(state.result?.data ?? {}, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'my-waitlist-data.json';
        a.click();
        URL.revokeObjectURL(url);
      }}
    />
  );
}

export function PrivacyRequestPage() {
  // Read once, then off the address bar: the token should not stay in history or in a shared screenshot.
  const [token] = useState(() => (typeof window === 'undefined' ? null : tokenFromHash(window.location.hash)));
  useEffect(() => {
    if (token) window.history.replaceState(null, '', window.location.pathname);
  }, [token]);
  return (
    <SitePage title={token ? 'Confirm your privacy request' : 'Privacy request'} eyebrow="Legal" narrow lead={token ? undefined : 'If you joined the early-access waitlist or have no account with us, ask here. If you have an account, sign in and use Privacy in your account instead. We email you a link first, so only you can act on your address.'}>
      {token ? <ConfirmPanel token={token} /> : <RequestPanel />}
    </SitePage>
  );
}
