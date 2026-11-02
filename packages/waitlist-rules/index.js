/*
 * Input validation of POST /api/public/waitlist, for both backends: the gateway and the website's
 * Functions (services/site-api). Hand written like the rest of the gateway's request checks: strict
 * types, trimmed strings, length limits, no control characters, and the field rules (enabled,
 * required, role choices) come from the site configuration so the form and the endpoint agree.
 */

export const HONEYPOT_FIELD = 'website';
export const EMAIL_MAX = 254;
export const ORGANISATION_MAX = 120;
export const ROLE_MAX = 80;

// Local part up to 64 characters: printable ASCII without whitespace, quotes, brackets or the separators " ( ) , : ; < > [ \ ],
// no dot first or last, no consecutive dots. Domain: dotted, with a 2+ letter TLD.
const EMAIL = /^(?!\.)[!#-'*+\-./0-9=?A-Z^-~]{1,64}(?<!\.)@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function isEmail(v) {
  return v.length <= EMAIL_MAX && EMAIL.test(v) && !v.includes('..');
}

export function honeypotTripped(body) {
  const v = body && typeof body === 'object' ? body[HONEYPOT_FIELD] : undefined;
  return v !== undefined && v !== null && v !== '' && v !== false;
}

export const normaliseEmail = (email) => email.normalize('NFC').trim().toLowerCase();

function text(raw, max, errors, key, label) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    errors[key] = `${label} must be text`;
    return undefined;
  }
  const v = raw.trim();
  if (!v) return undefined;
  if (CONTROL.test(v)) errors[key] = `${label} contains characters that are not allowed`;
  else if (v.length > max) errors[key] = `${label} must be at most ${max} characters`;
  else return v;
  return undefined;
}

export function checkWaitlist(body, cfg) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Expected a JSON object', fields: {} };
  const b = body;
  const errors = {};
  const fields = cfg.fields ?? {};
  const on = (f) => f?.enabled !== false;

  let email;
  if (typeof b.email !== 'string' || !b.email.trim()) errors.email = 'Enter your email address';
  else {
    email = b.email.trim();
    if (!isEmail(email)) {
      errors.email = 'Enter a valid email address';
      email = undefined;
    }
  }

  const organisation = on(fields.organisation) ? text(b.organisation, ORGANISATION_MAX, errors, 'organisation', 'Organisation') : undefined;
  if (on(fields.organisation) && fields.organisation?.required && !organisation && !errors.organisation) errors.organisation = 'Enter your organisation';

  let role = on(fields.role) ? text(b.role, ROLE_MAX, errors, 'role', 'Role') : undefined;
  if (role && fields.role?.options?.length && !fields.role.options.includes(role)) {
    errors.role = 'Choose one of the listed roles';
    role = undefined;
  }
  if (on(fields.role) && fields.role?.required && !role && !errors.role) errors.role = 'Choose your role';

  let interest;
  if (on(fields.interest) && b.interest !== undefined && b.interest !== null && b.interest !== '') {
    if (b.interest === 'enterprise' || b.interest === 'individual') interest = b.interest;
    else errors.interest = 'Choose enterprise or individual';
  }
  if (on(fields.interest) && fields.interest?.required && !interest && !errors.interest) errors.interest = 'Choose enterprise or individual';

  if (b.consent !== true) errors.consent = 'Please agree to the privacy notice to join the waitlist';

  if (Object.keys(errors).length) return { ok: false, message: 'Check the highlighted fields', fields: errors };
  return { ok: true, input: { email, ...(organisation ? { organisation } : {}), ...(role ? { role } : {}), ...(interest ? { interest } : {}) } };
}
