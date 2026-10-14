import { Link } from '@tanstack/react-router';
import { ArrowRight, CalendarRange, Plus, Presentation, Users } from 'lucide-react';
import { useState } from 'react';
import { useCatalog } from '@/api/client';
import { useAdminUsers, useCreateCohort, useCohorts } from '@/api/platform';
import type { Cohort, CohortStatus } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { initials } from '@/app/Shell';
import { useShell } from '@/app/shell-context';
import { Badge, Button, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, PageSkeleton, Select } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';

export function Cohorts() {
  return (
    <RequireAccess path="/cohorts">
      <CohortsScreen />
    </RequireAccess>
  );
}

const statusMeta: Record<CohortStatus, { label: string; tone: 'ok' | 'neutral' | 'accent' }> = { live: { label: 'Live', tone: 'ok' }, upcoming: { label: 'Upcoming', tone: 'accent' }, ended: { label: 'Ended', tone: 'neutral' } };

function CohortsScreen() {
  const q = useCohorts();
  const [create, setCreate] = useState(false);
  const groups: CohortStatus[] = ['live', 'upcoming', 'ended'];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Instructor</div>
          <h1>Cohorts</h1>
          <p className="muted">Workshops and bootcamps you run. Open a live cohort for the board: every learner's session, checks and stuck signals.</p>
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreate(true)}>
          New cohort
        </Button>
      </header>

      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={<Presentation size={20} />} title="No cohorts yet" description="Create one for your next workshop: pick a path, add the learners, set the dates." action={<Button variant="primary" onClick={() => setCreate(true)}>New cohort</Button>} />
      ) : (
        <div className="stack" style={{ gap: 24 }}>
          {groups.map((g) => {
            const list = q.data.filter((c) => c.status === g);
            if (!list.length) return null;
            return (
              <section key={g} aria-labelledby={`cohorts-${g}`}>
                <div className="section-header">
                  <h2 id={`cohorts-${g}`} className="row" style={{ gap: 8 }}>
                    {statusMeta[g].label} <span className="subtle small tnum">{list.length}</span>
                  </h2>
                </div>
                <div className={cn(list.length > 1 ? 'grid-2' : '')}>
                  {list.map((c) => (
                    <CohortCard key={c.id} c={c} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <CreateCohortDialog open={create} onOpenChange={setCreate} />
    </div>
  );
}

function CohortCard({ c }: { c: Cohort }) {
  const catalog = useCatalog();
  const path = c.pathId ? catalog.data?.paths.find((p) => p.id === c.pathId) : undefined;
  return (
    <Link to="/cohorts/$cohortId" params={{ cohortId: c.id }} className="card card-interactive stack" style={{ gap: 10 }}>
      <div className="row-between">
        <Badge tone={statusMeta[c.status].tone}>{statusMeta[c.status].label}</Badge>
        <ArrowRight size={14} className="subtle" />
      </div>
      <h3>{c.name}</h3>
      <div className="row xs subtle" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 4 }}>
          <CalendarRange size={11} /> {formatDate(c.startsAt)} – {formatDate(c.endsAt)}
        </span>
        <span className="row" style={{ gap: 4 }}>
          <Users size={11} /> {c.memberCount} learners
        </span>
        <span>{path ? path.title : `${c.labIds.length} labs`}</span>
      </div>
      <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
        <span className="avatar-stack" aria-label={`Instructors: ${c.instructors.map((i) => i.name).join(', ')}`}>
          {c.instructors.map((i) => (
            <span key={i.id} className="avatar" title={i.name}>
              {initials(i.name)}
            </span>
          ))}
        </span>
        <span className="xs subtle">{c.instructors.map((i) => i.name.split(' ')[0]).join(', ')}</span>
      </div>
    </Link>
  );
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function CreateCohortDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const catalog = useCatalog();
  const users = useAdminUsers({ limit: 200 });
  const create = useCreateCohort();
  const { toast } = useShell();
  const [name, setName] = useState('');
  const [pathId, setPathId] = useState('');
  const [startsAt, setStartsAt] = useState(isoDate(new Date(Date.now() + 7 * 86_400_000)));
  const [endsAt, setEndsAt] = useState(isoDate(new Date(Date.now() + 35 * 86_400_000)));
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const candidates = (users.data?.items ?? []).filter((u) => u.status === 'active' && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())));
  const valid = name.trim().length > 1 && !!pathId && startsAt < endsAt;

  const submit = () =>
    create.mutate(
      { name: name.trim(), pathId, startsAt: new Date(`${startsAt}T09:00:00`).toISOString(), endsAt: new Date(`${endsAt}T17:00:00`).toISOString(), memberIds },
      {
        onSuccess: (c) => {
          toast({ title: 'Cohort created', description: `${c.name} · ${c.memberCount} learners`, tone: 'ok' });
          onOpenChange(false);
          setName('');
          setMemberIds([]);
        },
        onError: (e) => toast({ title: 'Could not create the cohort', description: e.message, tone: 'err' }),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New cohort" description="A cohort groups learners for a workshop: shared path, dates, a live board and broadcasts." width={620}>
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Name" required>
          {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CKS bootcamp · Q1" autoFocus />}
        </Field>
        <div className="grid-3" style={{ gap: 12 }}>
          <Field label="Path" required>
            {({ id }) => (
              <Select id={id} value={pathId} onChange={(e) => setPathId(e.target.value)}>
                <option value="">Choose a path</option>
                {(catalog.data?.paths ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Starts">{({ id }) => <Input id={id} type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>
          <Field label="Ends" error={startsAt >= endsAt ? 'Must be after the start' : undefined}>
            {({ id, invalid }) => <Input id={id} aria-invalid={invalid} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
          </Field>
        </div>
        <div>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="field-label">Learners · {memberIds.length} selected</span>
            <input className="input" style={{ width: 200, height: 28 }} placeholder="Filter people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter people" />
          </div>
          <div className="pick-scroll">
            {users.isPending ? (
              <p className="small muted" style={{ padding: 12 }}>
                Loading people…
              </p>
            ) : users.isError ? (
              <p className="small muted" style={{ padding: 12 }}>
                The people list needs the user.manage permission; you can add learners after creating the cohort.
              </p>
            ) : (
              candidates.map((u) => <Checkbox key={u.id} className="pick-check-row" label={u.name} description={`${u.title ?? ''}${u.teams.length ? ` · ${u.teams.map((t) => t.name).join(', ')}` : ''}`} checked={memberIds.includes(u.id)} onChange={(e) => setMemberIds((ids) => (e.target.checked ? [...ids, u.id] : ids.filter((x) => x !== u.id)))} />)
            )}
          </div>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} loading={create.isPending} onClick={submit}>
            Create cohort
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
