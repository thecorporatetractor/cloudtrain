import { describe, expect, it, vi } from 'vitest';
import { isMockWorker, removeMockWorkers } from './mockWorker';

describe('mock service worker cleanup', () => {
  it('recognises only the MSW script', () => {
    expect(isMockWorker('https://app.example/mockServiceWorker.js')).toBe(true);
    expect(isMockWorker('https://app.example/base/mockServiceWorker.js?v=2')).toBe(true);
    expect(isMockWorker('https://app.example/sw.js')).toBe(false);
    expect(isMockWorker(undefined)).toBe(false);
  });

  it('unregisters the mock worker and leaves others alone', async () => {
    const mock = { active: { scriptURL: 'https://app.example/mockServiceWorker.js' }, unregister: vi.fn(async () => true) };
    const other = { active: { scriptURL: 'https://app.example/sw.js' }, unregister: vi.fn(async () => true) };
    expect(await removeMockWorkers({ getRegistrations: async () => [mock, other] })).toBe(1);
    expect(mock.unregister).toHaveBeenCalledOnce();
    expect(other.unregister).not.toHaveBeenCalled();
  });

  it('never throws (no service worker support, or a refusal)', async () => {
    expect(await removeMockWorkers(undefined)).toBe(0);
    expect(await removeMockWorkers({ getRegistrations: async () => Promise.reject(new Error('SecurityError')) })).toBe(0);
  });
});
