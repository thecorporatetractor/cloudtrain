import { describe, expect, it } from 'vitest';
import { apiCredentials, apiOrigin, apiUrl, parseRuntimeConfig, wsUrl } from './runtimeConfig';

const same = parseRuntimeConfig(undefined);
const split = parseRuntimeConfig({ apiBase: 'https://api.labs.example.com/', environment: 'staging' });

describe('runtime config', () => {
  it('defaults to the page origin', () => {
    expect(same).toEqual({ apiBase: '', environment: '' });
    expect(apiUrl('/api/me', same)).toBe('/api/me');
    expect(wsUrl('/api/sessions/s1/terminal?x=1', { protocol: 'https:', host: 'labs.example.com' }, same)).toBe('wss://labs.example.com/api/sessions/s1/terminal?x=1');
    expect(wsUrl('/api/t', { protocol: 'http:', host: '127.0.0.1:5173' }, same)).toBe('ws://127.0.0.1:5173/api/t');
    expect(apiOrigin('https://labs.example.com', same)).toBe('https://labs.example.com');
    expect(apiCredentials(same)).toBe('same-origin');
  });

  it('prefixes gateway paths with a separate API origin', () => {
    expect(split).toEqual({ apiBase: 'https://api.labs.example.com', environment: 'staging' });
    expect(apiUrl('/api/me', split)).toBe('https://api.labs.example.com/api/me');
    expect(apiUrl('/assets/x.js', split)).toBe('/assets/x.js');
    expect(wsUrl('/api/t', { protocol: 'http:', host: 'x' }, split)).toBe('wss://api.labs.example.com/api/t');
    expect(apiOrigin('https://labs.example.com', split)).toBe('https://api.labs.example.com');
    expect(apiCredentials(split)).toBe('include');
  });

  it('ignores invalid values instead of breaking the page', () => {
    expect(parseRuntimeConfig({ apiBase: 'javascript:alert(1)' }).apiBase).toBe('');
    expect(parseRuntimeConfig({ apiBase: 'not a url' }).apiBase).toBe('');
    expect(parseRuntimeConfig({ apiBase: 42, environment: {} })).toEqual({ apiBase: '', environment: '' });
    expect(parseRuntimeConfig('x')).toEqual({ apiBase: '', environment: '' });
    // A path is dropped: the gateway always serves /api at the root of its origin.
    expect(parseRuntimeConfig({ apiBase: 'https://h.example.com/prefix' }).apiBase).toBe('https://h.example.com');
  });
});
