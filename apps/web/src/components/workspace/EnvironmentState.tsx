import { AlertTriangle, Loader2, Moon, Power } from 'lucide-react';
import type { LabSession } from '@/api/types';
import { StatusDot } from '@/components/domain';
import { Badge, Button } from '@/components/ui';

const phaseLabel: Record<NonNullable<LabSession['phase']>, string> = {
  pending: 'Queued',
  provisioning: 'Provisioning',
  ready: 'Ready',
  grading: 'Grading',
  hibernated: 'Hibernated',
  expired: 'Ended',
  failed: 'Failed',
};

/** What the terminals panel says while the environment is not usable (real API mode). */
export function environmentHeadline(session: LabSession | undefined): { tone: 'busy' | 'err' | 'over' | 'paused'; text: string } {
  if (session?.status === 'failed' || session?.phase === 'failed') return { tone: 'err', text: 'The lab environment could not start' };
  if (session?.status === 'expired' || session?.phase === 'expired') return { tone: 'over', text: 'This session has ended' };
  // Hibernation stops the environment's compute; nothing in the browser can wake it yet.
  if (session?.phase === 'hibernated') return { tone: 'paused', text: 'This lab environment is paused' };
  if (!session) return { tone: 'busy', text: 'Requesting a lab environment' };
  const ready = session.nodes.filter((n) => n.status === 'ready').length;
  return { tone: 'busy', text: `Starting your lab environment · ${ready}/${session.nodes.length} nodes ready` };
}

/** Real API mode: what stands in for the terminals until the environment is ready (or after it failed). */
export function EnvironmentState({ session, onRestart }: { session: LabSession | undefined; onRestart: () => void }) {
  const head = environmentHeadline(session);
  const failed = head.tone === 'err';
  return (
    <div className="ws-env" role="status" aria-live="polite">
      <div className="ws-env-card">
        <div className="row" style={{ gap: 8 }}>
          {failed ? <AlertTriangle size={15} className="text-err" /> : head.tone === 'over' ? <Power size={15} className="subtle" /> : head.tone === 'paused' ? <Moon size={15} className="subtle" /> : <Loader2 size={15} className="spin subtle" aria-hidden />}
          <strong>{head.text}</strong>
          {session?.phase && <Badge tone={failed ? 'err' : 'neutral'}>{phaseLabel[session.phase]}</Badge>}
        </div>
        {session?.message && <p className="small muted ws-env-msg">{session.message}</p>}
        {head.tone === 'paused' && <p className="small muted ws-env-msg">It was paused to save compute, and resuming it from the browser is not available yet. End the lab to free it, then start the lab again.</p>}
        {session && session.nodes.length > 0 && head.tone !== 'paused' && (
          <ul className="ws-env-nodes">
            {session.nodes.map((n) => (
              <li key={n.name} className="row small" style={{ gap: 8 }}>
                <StatusDot status={n.status} />
                <span className="mono">{n.name}</span>
                <span className="subtle xs">{n.status}</span>
                {n.ip && <span className="subtle xs mono">{n.ip}</span>}
                {n.message && <span className="subtle xs truncate">{n.message}</span>}
              </li>
            ))}
          </ul>
        )}
        {/* Not for a paused session: the gateway reattaches a start to it (sessions.live() counts a
            hibernated session as running), so "Start a new session" would land on this same card. */}
        {(head.tone === 'err' || head.tone === 'over') && (
          <div className="row" style={{ gap: 8 }}>
            <Button variant="primary" size="sm" onClick={onRestart}>
              Start a new session
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
