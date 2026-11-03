import { describe, expect, it } from 'vitest';
import type { Me, Permission } from '@/api/types';
import { canAccess, isUnavailable, notAvailableCopy } from './access';

const me = (...permissions: Permission[]) => ({ id: 'u', permissions, managedTeams: [] }) as unknown as Me;

describe('demo-only screens', () => {
  it('Scenario Studio and global content are hidden with a real API', () => {
    const author = me('studio.author', 'org.manage');
    expect(canAccess(author, '/studio', true)).toBe(false);
    expect(canAccess(author, '/studio/draft-1', true)).toBe(false);
    expect(canAccess(author, '/platform/content', true)).toBe(false);
    expect(isUnavailable('/studio', true)).toBe(true);
    expect(isUnavailable('/platform/content', true)).toBe(true);
  });

  it('stay in the in-browser demo', () => {
    const author = me('studio.author', 'org.manage');
    expect(canAccess(author, '/studio', false)).toBe(true);
    expect(canAccess(author, '/platform/content', false)).toBe(true);
    expect(isUnavailable('/studio', false)).toBe(false);
  });

  it('other platform screens are unaffected', () => {
    const admin = me('org.manage', 'capacity.read');
    expect(canAccess(admin, '/platform', true)).toBe(true);
    expect(canAccess(admin, '/platform/capacity', true)).toBe(true);
    expect(canAccess(admin, '/platform/privacy', true)).toBe(true);
    expect(isUnavailable('/catalog', true)).toBe(false);
  });

  it('opened by URL, the screen says it is not available rather than forbidden', () => {
    const copy = notAvailableCopy('/studio');
    expect(copy.title).toBe('Scenario Studio is not available yet');
    expect(copy.description).not.toContain('permission');
    expect(notAvailableCopy('/platform/content').title).toBe('Global content is not available yet');
  });
});
