import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkWaitlist, honeypotTripped, isEmail, normaliseEmail } from '../index.js';

const cfg = { enabled: true, fields: { role: { options: ['Engineer'] }, organisation: {}, interest: {} } };

test('a valid entry comes back trimmed, with only what was given', () => {
  assert.deepEqual(checkWaitlist({ email: ' a@example.com ', role: 'Engineer', consent: true, extra: 'x' }, cfg), { ok: true, input: { email: 'a@example.com', role: 'Engineer' } });
});

test('field errors, consent required', () => {
  const r = checkWaitlist({ email: 'nope', role: 'Pirate', interest: 'x', organisation: 'a\u0001', consent: false }, cfg);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.fields).sort(), ['consent', 'email', 'interest', 'organisation', 'role']);
});

test('email format: what passes', () => {
  for (const e of ['a@example.com', 'a.b@example.com', 'first.last+tag@sub.example.co', 'a+b+c@example.com', "o'neil@example.com", 'a_b-c=d?e!f#g$h%i&j*k/l^m`n{o|p}q~r@example.com', 'A.B@EXAMPLE.COM', `${'a'.repeat(64)}@example.com`]) assert.equal(isEmail(e), true, e);
});

test('email format: what does not', () => {
  for (const c of [' ', '\t', '"', '(', ')', ',', ':', ';', '<', '>', '[', '\\', ']', '@', '\u007f', '\u0001', 'á', '\u017f', '\u212a']) assert.equal(isEmail(`a${c}b@example.com`), false, JSON.stringify(c));
  for (const e of ['.a@example.com', 'a.@example.com', 'a..b@example.com', '@example.com', 'a@b', 'a@-b.com', 'a@b..com', `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.${'f'.repeat(10)}.com`]) assert.equal(isEmail(e), false, e);
});

test('a body that is not an object has no field errors', () => {
  for (const b of [null, 'x', [], 1]) assert.deepEqual(checkWaitlist(b, cfg), { ok: false, message: 'Expected a JSON object', fields: {} });
});

test('honeypot, addresses and the normal form', () => {
  assert.equal(honeypotTripped({ website: 'x' }), true);
  for (const b of [{}, { website: '' }, { website: null }, null]) assert.equal(honeypotTripped(b), false);
  assert.equal(isEmail('a.b+c@sub.example.co'), true);
  for (const e of ['a@b', 'a..b@example.com', '.a@example.com', 'a b@example.com']) assert.equal(isEmail(e), false);
  assert.equal(normaliseEmail('  Á@Example.COM '), 'á@example.com');
});
