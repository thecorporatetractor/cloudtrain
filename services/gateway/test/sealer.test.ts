import { describe, expect, it } from 'vitest';
import { Sealer } from '../src/oidc/sessions.js';

describe('Sealer', () => {
  const s = new Sealer('test-session-secret-0123456789');

  it('round-trips', () => {
    expect(s.open(s.seal('refresh-token'))).toBe('refresh-token');
  });

  it('rejects a truncated auth tag', () => {
    const [iv, tag, body] = s.seal('refresh-token').split('.');
    const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    expect(s.open([iv, short, body].join('.'))).toBeNull();
  });

  it('rejects tampering, a wrong key and malformed input', () => {
    const [iv, tag, body] = s.seal('refresh-token').split('.');
    const flipped = Buffer.from(body!, 'base64url');
    flipped[0]! ^= 1;
    expect(s.open([iv, tag, flipped.toString('base64url')].join('.'))).toBeNull();
    expect(new Sealer('another-secret-0123456789').open(s.seal('x'))).toBeNull();
    expect(s.open('')).toBeNull();
    expect(s.open('a.b')).toBeNull();
  });
});
