import { describe, expect, it } from 'vitest';
import type { LabSession } from '../src/kube/types.js';
import { usageEnd } from '../src/sessions/usage.js';

const at = (m: number) => new Date(Date.parse('2026-11-04T10:00:00Z') + m * 60_000);
const session = (status: LabSession['status'], spec: Partial<LabSession['spec']> = {}): LabSession =>
  ({ apiVersion: 'labs.cloudtrain.dev/v1alpha1', kind: 'LabSession', metadata: { name: 's' }, spec: { templateRef: { name: 't' }, learner: { id: 'u' }, seed: 1, ...spec }, status }) as LabSession;

describe('metered window of a lab session', () => {
  it('starts at the first Ready and ends now, at most at the expiry', () => {
    expect(usageEnd(session({ phase: 'Ready', readyAt: at(5).toISOString(), expiresAt: at(60).toISOString() }), at(30).getTime())).toEqual({ end: at(30), readyAt: at(5) });
    expect(usageEnd(session({ phase: 'Expired', readyAt: at(5).toISOString(), expiresAt: at(60).toISOString() }), at(200).getTime())).toEqual({ end: at(60), readyAt: at(5) });
    // spec.expiresAt when status has none yet.
    expect(usageEnd(session({ phase: 'Ready', readyAt: at(1).toISOString() }, { expiresAt: at(45).toISOString() }), at(90).getTime()).end).toEqual(at(45));
  });

  it('a lab that never became ready has no readyAt (not billed)', () => {
    expect(usageEnd(session({ phase: 'Provisioning' }), at(10).getTime())).toEqual({ end: at(10), readyAt: null });
    expect(usageEnd(session(undefined), at(10).getTime()).readyAt).toBeNull();
  });

  it('a failed lab ends when it stopped being ready', () => {
    const failed = session({ phase: 'Failed', readyAt: at(5).toISOString(), expiresAt: at(60).toISOString(), conditions: [{ type: 'Ready', status: 'False', reason: 'SetupFailed', lastTransitionTime: at(20).toISOString() }] });
    expect(usageEnd(failed, at(50).getTime())).toEqual({ end: at(20), readyAt: at(5) });
  });

  it('a failed lab ends when it stopped being ready, also once it expired or is being deleted', () => {
    const failedConds = (reason: string) => [{ type: 'Ready', status: 'False' as const, reason, lastTransitionTime: at(20).toISOString() }];
    // The orchestrator expired it before the sweep closed it: the reason is Expired now, the transition time is the failure's.
    const expired = session({
      phase: 'Expired',
      readyAt: at(5).toISOString(),
      expiresAt: at(60).toISOString(),
      conditions: [...failedConds('Expired'), { type: 'Expired', status: 'True', reason: 'Expired', lastTransitionTime: at(60).toISOString() }],
    });
    expect(usageEnd(expired, at(90).getTime())).toEqual({ end: at(20), readyAt: at(5) });
    // Being deleted (phaseOf says expired) while Failed.
    const deleting = session({ phase: 'Failed', readyAt: at(5).toISOString(), expiresAt: at(60).toISOString(), conditions: failedConds('NodeFailed') });
    deleting.metadata.deletionTimestamp = at(40).toISOString();
    expect(usageEnd(deleting, at(40).getTime()).end).toEqual(at(20));
    // A failure reason caps the end whatever the phase says.
    expect(usageEnd(session({ phase: 'Expired', readyAt: at(5).toISOString(), conditions: failedConds('ProvisionDeadline') }), at(40).getTime()).end).toEqual(at(20));
  });

  it('a lab that expired while ready, or hibernated, is billed to its expiry', () => {
    const conds = (readyFalseAt: number) => [
      { type: 'Ready', status: 'False' as const, reason: 'Expired', lastTransitionTime: at(readyFalseAt).toISOString() },
      { type: 'Expired', status: 'True' as const, reason: 'Expired', lastTransitionTime: at(60).toISOString() },
    ];
    expect(usageEnd(session({ phase: 'Expired', readyAt: at(5).toISOString(), expiresAt: at(60).toISOString(), conditions: conds(60) }), at(90).getTime()).end).toEqual(at(60));
    const hibernated = session({ phase: 'Expired', readyAt: at(5).toISOString(), expiresAt: at(60).toISOString(), conditions: conds(30) }, { hibernate: true });
    expect(usageEnd(hibernated, at(90).getTime()).end).toEqual(at(60));
    // Re-provisioning (a reset) is not a failure: a learner ending it now is billed to now.
    const resetting = session({ phase: 'Provisioning', readyAt: at(5).toISOString(), conditions: [{ type: 'Ready', status: 'False', reason: 'ResetRequested', lastTransitionTime: at(20).toISOString() }] });
    expect(usageEnd(resetting, at(30).getTime()).end).toEqual(at(30));
  });
});
