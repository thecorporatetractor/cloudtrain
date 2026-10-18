import { describe, expect, it } from 'vitest';
import type { Framework } from '@/api/types';
import { frameworks as mockFrameworks, skills as mockSkills } from '@/mocks/fixtures/skills';
import { coverageInProgress, frameworkSearchText, groupFrameworks, matchesFramework } from './frameworks';
import { frameworkReadiness } from './readiness';

const fw = (id: string, name: string, group: string, over: Partial<Framework> = {}): Framework => ({ id, name, fullName: `${name} full name`, vendor: 'Body', group, coverage: 1, domains: [], ...over });

describe('groupFrameworks', () => {
  it('keeps the API order of groups and of frameworks within them', () => {
    const list = [fw('a', 'A', 'Kubernetes'), fw('b', 'B', 'Kubernetes'), fw('c', 'C', 'Linux'), fw('d', 'D', 'Platform')];
    expect(groupFrameworks(list).map((g) => [g.group, g.frameworks.map((f) => f.id)])).toEqual([
      ['Kubernetes', ['a', 'b']],
      ['Linux', ['c']],
      ['Platform', ['d']],
    ]);
  });

  it('returns no groups for no frameworks', () => {
    expect(groupFrameworks([])).toEqual([]);
  });
});

describe('matchesFramework', () => {
  const rhcsa = fw('rhcsa-aligned', 'RHCSA', 'Linux', { fullName: 'Red Hat Certified System Administrator objective themes', vendor: 'Red Hat, Inc.' });

  it('finds by short name, full name, body, group and id, ignoring case', () => {
    for (const q of ['rhcsa', 'RHCSA', 'system admin', 'red hat', 'linux', 'rhcsa-aligned']) expect(matchesFramework(rhcsa, q), q).toBe(true);
  });

  it('needs every term and matches everything for an empty query', () => {
    expect(matchesFramework(rhcsa, 'red hat terraform')).toBe(false);
    expect(matchesFramework(rhcsa, '   ')).toBe(true);
    expect(frameworkSearchText(rhcsa)).toContain('red hat, inc.');
  });
});

describe('coverageInProgress', () => {
  it('flags frameworks whose labs reach under half of the objectives', () => {
    expect(coverageInProgress({ coverage: 0.2 })).toBe(true);
    expect(coverageInProgress({ coverage: 0.5 })).toBe(false);
    expect(coverageInProgress({ coverage: 1 })).toBe(false);
  });
});

describe('mock frameworks (mock mode serves the full set)', () => {
  it('has many frameworks across every group, ordered by group', () => {
    expect(mockFrameworks.length).toBeGreaterThanOrEqual(20);
    const groups = mockFrameworks.map((f) => f.group);
    expect(groups.filter((g, i) => g !== groups[i - 1])).toEqual(['Kubernetes', 'Linux', 'Containers', 'Infrastructure as code', 'Automation', 'Networking', 'Platform']);
    expect(new Set(mockFrameworks.map((f) => f.id)).size).toBe(mockFrameworks.length);
    expect(mockFrameworks.some(coverageInProgress)).toBe(true);
  });

  it('uses known skills, weights summing to 1, and a disclaimer for external bodies', () => {
    const known = new Set(mockSkills.map((s) => s.id));
    for (const f of mockFrameworks) {
      expect(f.domains.reduce((a, d) => a + d.weight, 0), f.id).toBeCloseTo(1);
      for (const d of f.domains) for (const s of d.skillIds) expect(known.has(s), `${d.id}: ${s}`).toBe(true);
      expect(!!f.disclaimer, f.id).toBe(f.vendor !== 'CloudTrain');
      expect(frameworkReadiness(f, []).readiness).toBe(0);
    }
  });
});
