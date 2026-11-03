import { describe, expect, it } from 'vitest';
import type { TopologyLink, TopologyNode } from '@/api/types';
import { terminalBackend } from './TerminalView';

const node: TopologyNode = { name: 'r1', driver: 'container', access: ['shell'] };
const link: TopologyLink = { a: 'r1:eth1', b: 'r2:eth1' };

describe('terminal backend', () => {
  it('never simulates output in a live lab', () => {
    expect(terminalBackend({ kind: 'console', node, access: 'shell' }, 's-1')).toBe('remote');
    expect(terminalBackend({ kind: 'capture', link }, 's-1')).toBe('capture-unavailable');
  });

  it('keeps the simulated shell and capture for the in-browser demo', () => {
    expect(terminalBackend({ kind: 'console', node, access: 'shell' }, undefined)).toBe('fake-shell');
    expect(terminalBackend({ kind: 'capture', link }, undefined)).toBe('fake-capture');
  });
});
