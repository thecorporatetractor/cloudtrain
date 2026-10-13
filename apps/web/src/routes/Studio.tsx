import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, CircleDashed, Sparkles, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import { useCreateDraft, useDrafts } from '@/api/client';
import type { StudioDraft } from '@/api/types';
import { RequireRole } from '@/app/access';
import { DomainIcon } from '@/components/domain';
import { Badge, Button, Card, EmptyState, ErrorState, PageSkeleton } from '@/components/ui';
import { cn, relativeTime } from '@/lib/utils';

export const STAGES: { id: StudioDraft['stage']; label: string }[] = [
  { id: 'describe', label: 'Describe' },
  { id: 'spec', label: 'Spec' },
  { id: 'verify', label: 'Verify' },
  { id: 'review', label: 'Review' },
  { id: 'pilot', label: 'Pilot' },
  { id: 'published', label: 'Published' },
];

const EXAMPLES = [
  'A medium CKA lab: the dispatch Deployment on the meadow cluster is stuck in CrashLoopBackOff because its ConfigMap key was renamed. Learners must find the cause from events and logs and fix it without recreating the Deployment.',
  'An easy Linux lab on granary-vm: create a sync group, add two users to it, give the group write access to /srv/share with setgid so new files inherit the group.',
  'A hard networking lab: yard-rtr-1 and yard-rtr-2 run OSPF but the link between them has an MTU mismatch, so the adjacency is stuck in ExStart. Learners diagnose and fix it.',
];

export function Studio() {
  return (
    <RequireRole path="/studio">
      <StudioScreen />
    </RequireRole>
  );
}

function StudioScreen() {
  const drafts = useDrafts();
  const create = useCreateDraft();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');

  const submit = () => {
    if (!prompt.trim()) return;
    create.mutate(prompt.trim(), { onSuccess: (d) => void navigate({ to: '/studio/$draftId', params: { draftId: d.id } }) });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Scenario Studio</div>
          <h1>Author a lab from a description</h1>
          <p className="muted">The planner drafts a spec, the builder writes it, and the verifier proves it in a real topology before anyone sees it.</p>
        </div>
      </header>

      <Card className="studio-compose">
        <label htmlFor="studio-prompt" className="row small" style={{ gap: 6, marginBottom: 8, fontWeight: 500 }}>
          <WandSparkles size={14} className="subtle" /> Describe the lab
        </label>
        <textarea
          id="studio-prompt"
          className="textarea"
          placeholder="Who is the learner, what is broken or missing, what must be true at the end? Mention the domain, difficulty and any misconception you want tested."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
          rows={4}
          disabled={create.isPending}
        />
        <div className="row-between" style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="xs subtle">Try:</span>
            {EXAMPLES.map((ex, i) => (
              <button key={i} className="chip" onClick={() => setPrompt(ex)} disabled={create.isPending}>
                {['Crash loop', 'Shared group dir', 'OSPF MTU'][i]}
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={submit} loading={create.isPending} disabled={!prompt.trim()} icon={<Sparkles size={14} />}>
            {create.isPending ? 'Planning…' : 'Generate spec'}
          </Button>
        </div>
        {create.isError && (
          <p className="small text-err" style={{ marginTop: 8 }}>
            {create.error.message}
          </p>
        )}
      </Card>

      <section className="page-section" aria-labelledby="drafts">
        <div className="section-header">
          <div>
            <h2 id="drafts">Drafts</h2>
            <p className="muted small">Everything in flight, from first description to pilot cohort.</p>
          </div>
        </div>
        {drafts.isPending ? (
          <PageSkeleton />
        ) : drafts.isError ? (
          <ErrorState error={drafts.error} onRetry={() => void drafts.refetch()} />
        ) : drafts.data.length === 0 ? (
          <EmptyState title="No drafts yet" description="Describe a lab above to start one." />
        ) : (
          <Card className="card-flush">
            <ul className="draft-list">
              {drafts.data.map((d) => (
                <li key={d.id}>
                  <Link to="/studio/$draftId" params={{ draftId: d.id }} className="draft-row">
                    <span className="stack grow" style={{ gap: 4, minWidth: 0 }}>
                      <span className="row" style={{ gap: 8 }}>
                        <span className="draft-icon" aria-hidden>
                          {d.spec ? <DomainIcon domain={d.spec.metadata.domain} size={13} /> : <CircleDashed size={13} />}
                        </span>
                        <span className="truncate" style={{ fontWeight: 500 }}>
                          {d.title}
                        </span>
                      </span>
                      <span className="xs subtle truncate">
                        {d.author} · {relativeTime(d.createdAt)} · {d.prompt}
                      </span>
                    </span>
                    <StagePips stage={d.stage} gates={d.gates} />
                    <ArrowRight size={14} className="subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

export function StagePips({ stage, gates }: { stage: StudioDraft['stage']; gates: StudioDraft['gates'] }) {
  const idx = STAGES.findIndex((s) => s.id === stage);
  const failed = gates.some((g) => g.status === 'failed');
  const running = gates.some((g) => g.status === 'running');
  return (
    <span className="stage-pips" aria-label={`Stage: ${STAGES[idx]?.label}`}>
      {STAGES.map((s, i) => (
        <span key={s.id} className={cn('stage-pip', i < idx && 'is-done', i === idx && 'is-current', i === idx && s.id === 'verify' && failed && 'is-failed', i === idx && s.id === 'verify' && running && 'is-running')} title={s.label} />
      ))}
      <Badge tone={failed && stage === 'verify' ? 'err' : stage === 'pilot' || stage === 'published' ? 'ok' : 'neutral'} className="stage-label">
        {STAGES[idx]?.label}
        {stage === 'verify' && failed ? ' · failed' : ''}
      </Badge>
    </span>
  );
}
