import type { PublicKeyEntry } from './token.js';

/*
 * Public keys this gateway accepts for license signatures (docs/licensing-keys.md,
 * "Rotating the signing key"). Only public keys live here; the private signing key
 * stays with the issuer and is never committed.
 *
 * Rotation: add the new key (new kid) and issue new licenses with it; keep the old
 * entry so licenses it signed keep working until they expire. If a key is retired
 * (or leaked), set `retiredAt`: licenses it signed later than that are refused.
 */
export const ACCEPTED_KEYS: readonly PublicKeyEntry[] = [
  {
    kid: 'ct-2026-10',
    label: 'CloudTrain license signing key (2026-10-21)',
    publicKey: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAq/9eOwnjssZ3qG/swONF2BudZc47YXq2vXFPXn2qw8I=
-----END PUBLIC KEY-----`,
  },
];
