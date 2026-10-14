import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Building2, KeyRound, LogOut, ShieldCheck, TimerOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, useMe } from '@/api/client';
import { isRealApi } from '@/api/mode';
import { useDiscover, useMockLogin } from '@/api/platform';
import { Button, Field, Input } from '@/components/ui';
import { signInRoute } from '@/router';

/**
 * Identity-first sign-in. Step 1 asks for the email; the gateway's discovery
 * answer decides whether the org signs in through its IdP ("Continue with …") or
 * with a local password. Real mode hands the browser to `/api/auth/login`, which
 * starts the OIDC flow at Keycloak; mock mode completes the login in place.
 */
export function SignIn() {
  const search = signInRoute.useSearch();
  const navigate = useNavigate();
  const me = useMe();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [password, setPassword] = useState('');
  const [redirecting, setRedirecting] = useState(false);
  const discover = useDiscover(submitted);
  const login = useMockLogin();
  const returnTo = search.returnTo && search.returnTo.startsWith('/') && !search.returnTo.startsWith('//') ? search.returnTo : '/';

  // Already signed in (e.g. the back button): go where they were headed.
  useEffect(() => {
    if (me.isSuccess && !search.signedOut) void navigate({ to: returnTo as '/', replace: true });
  }, [me.isSuccess, navigate, returnTo, search.signedOut]);

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return;
    setSubmitted(v);
  };

  const continueWithIdp = () => {
    const d = discover.data;
    if (!d) return;
    setRedirecting(true);
    if (isRealApi) {
      window.location.assign(`${d.loginUrl}${d.loginUrl.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    // Mock: the IdP round-trip is simulated.
    window.setTimeout(() => login.mutate({ email: d.email }, { onSuccess: () => void navigate({ to: returnTo as '/', replace: true }), onError: () => setRedirecting(false) }), 900);
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    const d = discover.data;
    if (!d) return;
    if (isRealApi) {
      window.location.assign(`${d.loginUrl}&returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    login.mutate({ email: d.email, password }, { onSuccess: () => void navigate({ to: returnTo as '/', replace: true }) });
  };

  const reset = () => {
    setSubmitted('');
    setPassword('');
    login.reset();
  };

  const d = submitted ? discover.data : undefined;
  const loginError = login.error instanceof ApiError ? login.error.message : login.error?.message;

  return (
    <div className="signin">
      <div className="signin-panel">
        <div className="signin-brand">
          <span className="brand-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M3 12.5h9.2a3.3 3.3 0 0 0 .4-6.57A4.6 4.6 0 0 0 4 7.6 2.5 2.5 0 0 0 3 12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M6.5 15.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-name">CloudTrain</span>
        </div>

        {search.reason === 'expired' && (
          <div className="signin-notice" role="status">
            <TimerOff size={14} className="subtle" />
            <span className="small">Your session expired. Sign in again to pick up where you left off.</span>
          </div>
        )}
        {search.signedOut && !submitted && (
          <div className="signin-notice" role="status">
            <LogOut size={14} className="subtle" />
            <span className="small">You are signed out.</span>
          </div>
        )}

        {!d ? (
          <form onSubmit={submitEmail} className="stack" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 4 }}>
              <h1>Sign in</h1>
              <p className="muted small">Enter your work email. Your organisation decides how you sign in.</p>
            </div>
            <Field label="Work email">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="email" autoComplete="username" inputMode="email" placeholder="you@company.example" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />}
            </Field>
            {discover.isError && (
              <p className="small text-err" role="alert">
                {discover.error.message}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" loading={discover.isFetching} icon={<ArrowRight size={14} />}>
              Continue
            </Button>
            {!isRealApi && (
              <div className="signin-demo">
                <div className="xs subtle" style={{ marginBottom: 6 }}>
                  Demo accounts (mock mode)
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {[
                    ['lena.varga@quillmoor.example', 'Learner · SSO'],
                    ['ingrid.solvang@quillmoor.example', 'Manager · SSO'],
                    ['raymond.okafor@acmefreight.example', 'Org admin · password'],
                    ['elin.marsh@azarguard.example', 'Platform admin'],
                  ].map(([addr, label]) => (
                    <button key={addr} type="button" className="chip" onClick={() => setEmail(addr!)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        ) : d.method === 'unknown' ? (
          <div className="stack" style={{ gap: 16 }}>
            <div className="stack" style={{ gap: 4 }}>
              <h1>We do not recognise that domain</h1>
              <p className="muted small">
                No organisation on CloudTrain claims <strong>{submitted.split('@')[1]}</strong>. Check the address, or ask your administrator for an invitation.
              </p>
            </div>
            <Button variant="secondary" icon={<ArrowLeft size={14} />} onClick={reset}>
              Use a different email
            </Button>
          </div>
        ) : d.method === 'sso' ? (
          <div className="stack" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 4 }}>
              <h1>{d.org?.name}</h1>
              <p className="muted small row" style={{ gap: 6 }}>
                <ShieldCheck size={13} /> Single sign-on is enforced for {submitted.split('@')[1]}.
              </p>
            </div>
            <div className="signin-account">
              <Building2 size={14} className="subtle" />
              <span className="small truncate">{submitted}</span>
              <button type="button" className="link-quiet xs" onClick={reset}>
                change
              </button>
            </div>
            <Button variant="primary" size="lg" onClick={continueWithIdp} loading={redirecting || login.isPending} icon={<KeyRound size={14} />}>
              Continue with {d.idpDisplayName ?? 'your identity provider'}
            </Button>
            {redirecting && <p className="xs subtle">Redirecting to {d.idpDisplayName ?? 'the identity provider'}…</p>}
            {loginError && (
              <p className="small text-err" role="alert">
                {loginError}
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={submitPassword} className="stack" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 4 }}>
              <h1>{d.org?.name}</h1>
              <p className="muted small">Sign in with your CloudTrain password.</p>
            </div>
            <div className="signin-account">
              <Building2 size={14} className="subtle" />
              <span className="small truncate">{submitted}</span>
              <button type="button" className="link-quiet xs" onClick={reset}>
                change
              </button>
            </div>
            {isRealApi ? (
              <Button type="submit" variant="primary" size="lg" icon={<KeyRound size={14} />}>
                Continue to sign in
              </Button>
            ) : (
              <>
                <Field label="Password" error={loginError}>
                  {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />}
                </Field>
                <Button type="submit" variant="primary" size="lg" loading={login.isPending} icon={<KeyRound size={14} />}>
                  Sign in
                </Button>
                <p className="xs subtle">Mock mode accepts any password of four characters or more.</p>
              </>
            )}
          </form>
        )}
      </div>
      <p className="signin-foot xs subtle">Hands-on labs on real infrastructure · CloudTrain by AzarGuard</p>
    </div>
  );
}
