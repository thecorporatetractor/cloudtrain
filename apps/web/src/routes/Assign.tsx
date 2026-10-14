import { Link, useNavigate } from '@tanstack/react-router';
import { Check, ChevronLeft, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCatalog, useSkills } from '@/api/client';
import { useCreateAssignment, useTeamDashboard } from '@/api/platform';
import type { AssignmentItemKind } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { initials } from '@/app/Shell';
import { useShell } from '@/app/shell-context';
import { DifficultyBadge, DomainIcon } from '@/components/domain';
import { Badge, Button, Card, Checkbox, ErrorState, Field, Input, PageSkeleton, Segmented, Select, Textarea } from '@/components/ui';
import { cn, formatDate, formatMinutes } from '@/lib/utils';
import { assignRoute } from '@/router';
import { useSelectedTeam } from './Team';

export function Assign() {
  return (
    <RequireAccess path="/team">
      <AssignScreen />
    </RequireAccess>
  );
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const quickDue = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '30 days', days: 30 },
];

function AssignScreen() {
  const search = assignRoute.useSearch();
  const navigate = useNavigate();
  const { teams, selected } = useSelectedTeam(search.team);
  const [teamId, setTeamId] = useState<string | undefined>(selected);
  useEffect(() => setTeamId((t) => t ?? selected), [selected]);
  const dash = useTeamDashboard(teamId);
  const catalog = useCatalog();
  const skills = useSkills();
  const create = useCreateAssignment();
  const { toast } = useShell();

  const [kind, setKind] = useState<AssignmentItemKind>(search.kind ?? 'lab');
  const [itemId, setItemId] = useState<string | undefined>(search.item);
  const [q, setQ] = useState('');
  const [whole, setWhole] = useState(!search.user);
  const [userIds, setUserIds] = useState<string[]>(search.user ? [search.user] : []);
  const [dueAt, setDueAt] = useState<string>(isoDate(new Date(Date.now() + 14 * 86_400_000)));
  const [noDue, setNoDue] = useState(false);
  const [required, setRequired] = useState(true);
  const [note, setNote] = useState('');

  const items = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (kind === 'lab') return (catalog.data?.labs ?? []).filter((l) => !needle || `${l.title} ${l.tags?.join(' ')} ${l.domain}`.toLowerCase().includes(needle)).map((l) => ({ id: l.id, title: l.title, meta: <span className="row xs subtle" style={{ gap: 8 }}><DomainIcon domain={l.domain} size={11} /> <DifficultyBadge difficulty={l.difficulty} compact /> {formatMinutes(l.estimatedMinutes)}</span> }));
    if (kind === 'path') return (catalog.data?.paths ?? []).filter((p) => !needle || `${p.title} ${p.domain}`.toLowerCase().includes(needle)).map((p) => ({ id: p.id, title: p.title, meta: <span className="row xs subtle" style={{ gap: 8 }}><DomainIcon domain={p.domain} size={11} /> {p.labIds.length} labs · {formatMinutes(p.estimatedMinutes)}</span> }));
    return (skills.data?.frameworks ?? []).filter((f) => !needle || `${f.name} ${f.fullName}`.toLowerCase().includes(needle)).map((f) => ({ id: f.id, title: `${f.name} readiness`, meta: <span className="xs subtle">{f.fullName} · {f.vendor}</span> }));
  }, [kind, q, catalog.data, skills.data]);

  const chosen = items.find((i) => i.id === itemId);
  const members = dash.data?.members ?? [];
  const targetCount = whole ? members.length : userIds.length;
  const canSubmit = !!chosen && !!teamId && targetCount > 0 && (noDue || !!dueAt) && !create.isPending;

  const submit = () => {
    if (!canSubmit || !chosen || !teamId) return;
    create.mutate(
      { item: { kind, id: chosen.id }, targets: whole ? [{ kind: 'team', id: teamId }] : userIds.map((id) => ({ kind: 'user' as const, id })), dueAt: noDue ? null : new Date(`${dueAt}T17:00:00`).toISOString(), required, note: note.trim() || undefined },
      {
        onSuccess: (r) => {
          toast({ title: `Assigned to ${whole ? dash.data?.team.name : `${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}`}`, description: `${chosen.title}${noDue ? '' : ` · due ${formatDate(dueAt)}`} · ${r.assignments.length} assignment${r.assignments.length === 1 ? '' : 's'} created`, tone: 'ok' });
          void navigate({ to: '/team/assignments', search: { team: teamId } });
        },
        onError: (e) => toast({ title: 'Could not assign', description: e.message, tone: 'err' }),
      },
    );
  };

  if (!teamId || dash.isPending || catalog.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (dash.isError || catalog.isError) {
    return (
      <div className="page">
        <ErrorState error={dash.error ?? catalog.error} onRetry={() => void (dash.refetch(), catalog.refetch())} />
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/team" search={{ team: teamId }} className="link-quiet small" style={{ marginBottom: 14 }}>
        <ChevronLeft size={13} /> {dash.data.team.name}
      </Link>
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Manager</div>
          <h1>Assign work</h1>
          <p className="muted">Pick a lab, path or framework, choose who gets it, set a due date. Learners see it on Home and in My assignments.</p>
        </div>
      </header>

      <div className="assign-layout">
        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2 className="row" style={{ gap: 8 }}>
                <span className="step-num">1</span> What
              </h2>
              <Segmented<AssignmentItemKind> label="Item kind" size="sm" value={kind} onChange={(k) => (setKind(k), setItemId(undefined))} options={[{ value: 'lab', label: 'Lab' }, { value: 'path', label: 'Path' }, { value: 'framework', label: 'Framework' }]} />
            </div>
            <div style={{ padding: '12px 16px 0' }}>
              <label className="search-field" style={{ width: '100%' }}>
                <Search size={13} aria-hidden />
                <input className="search-input" placeholder={`Search ${kind === 'framework' ? 'frameworks' : `${kind}s`}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
              </label>
            </div>
            <ul className="pick-list" role="radiogroup" aria-label="Item">
              {items.map((it) => (
                <li key={it.id}>
                  <button type="button" role="radio" aria-checked={itemId === it.id} className={cn('pick-row', itemId === it.id && 'is-on')} onClick={() => setItemId(it.id)}>
                    <span className="pick-check" aria-hidden>
                      {itemId === it.id && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                      <span className="small truncate" style={{ fontWeight: 500 }}>
                        {it.title}
                      </span>
                      {it.meta}
                    </span>
                  </button>
                </li>
              ))}
              {items.length === 0 && <li className="small muted" style={{ padding: 16 }}>Nothing matches.</li>}
            </ul>
          </Card>

          <Card className="card-flush">
            <div className="card-head">
              <h2 className="row" style={{ gap: 8 }}>
                <span className="step-num">2</span> Who
              </h2>
              {teams.length > 1 && (
                <Select aria-label="Team" value={teamId} onChange={(e) => (setTeamId(e.target.value), setUserIds([]))}>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <div style={{ padding: '12px 16px 4px' }}>
              <Segmented<'team' | 'people'> label="Target" size="sm" value={whole ? 'team' : 'people'} onChange={(v) => setWhole(v === 'team')} options={[{ value: 'team', label: (<span className="row" style={{ gap: 6 }}><Users size={12} /> Whole team ({members.length})</span>) }, { value: 'people', label: 'Specific people' }]} />
            </div>
            <ul className={cn('pick-list', whole && 'pick-list-muted')} aria-label="People">
              {members.map((m) => {
                const on = whole || userIds.includes(m.user.id);
                return (
                  <li key={m.user.id}>
                    <label className={cn('pick-row', on && 'is-on')}>
                      <input type="checkbox" className="sr-only" checked={on} disabled={whole} onChange={(e) => setUserIds((ids) => (e.target.checked ? [...ids, m.user.id] : ids.filter((x) => x !== m.user.id)))} />
                      <span className="pick-check" aria-hidden>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="avatar" aria-hidden>
                        {initials(m.user.name)}
                      </span>
                      <span className="stack grow" style={{ gap: 0, minWidth: 0 }}>
                        <span className="small truncate">{m.user.name}</span>
                        <span className="xs subtle truncate">
                          {m.user.title} · {m.assignments.total - m.assignments.completed} open
                        </span>
                      </span>
                      {m.assignments.overdue > 0 && <Badge tone="warn">{m.assignments.overdue} overdue</Badge>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <h2 className="row" style={{ gap: 8, marginBottom: 14 }}>
              <span className="step-num">3</span> When
            </h2>
            <div className="grid-2" style={{ gap: 16, alignItems: 'start' }}>
              <Field label="Due date" hint={noDue ? 'No deadline; it stays in “open” until completed.' : 'Learners see the date on Home and get a reminder three days before.'}>
                {({ id, describedBy }) => (
                  <div className="stack" style={{ gap: 8 }}>
                    <Input id={id} aria-describedby={describedBy} type="date" value={dueAt} min={isoDate(new Date())} disabled={noDue} onChange={(e) => setDueAt(e.target.value)} />
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {quickDue.map((qd) => (
                        <button key={qd.days} type="button" className="chip" disabled={noDue} onClick={() => setDueAt(isoDate(new Date(Date.now() + qd.days * 86_400_000)))}>
                          {qd.label}
                        </button>
                      ))}
                      <Checkbox label="No due date" checked={noDue} onChange={(e) => setNoDue(e.target.checked)} />
                    </div>
                  </div>
                )}
              </Field>
              <div className="stack" style={{ gap: 12 }}>
                <Checkbox label="Required" description="Counts toward completion rate; overdue required work flags the person as at risk." checked={required} onChange={(e) => setRequired(e.target.checked)} />
                <Field label="Note to learners" hint="Optional. One sentence on why.">
                  {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} style={{ minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Before the on-call rotation starts" />}
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <aside className="assign-summary">
          <Card className="stack" style={{ gap: 14, position: 'sticky', top: 24 }}>
            <h2>Summary</h2>
            <dl className="summary-list">
              <dt>Item</dt>
              <dd>{chosen ? chosen.title : <span className="subtle">Pick a {kind}</span>}</dd>
              <dt>To</dt>
              <dd>{whole ? `${dash.data.team.name} · ${members.length} people` : userIds.length ? `${userIds.length} ${userIds.length === 1 ? 'person' : 'people'} in ${dash.data.team.name}` : <span className="subtle">Pick people</span>}</dd>
              <dt>Due</dt>
              <dd>{noDue ? 'No due date' : dueAt ? formatDate(dueAt) : <span className="subtle">Pick a date</span>}</dd>
              <dt>Required</dt>
              <dd>{required ? 'Yes' : 'No'}</dd>
            </dl>
            <Button variant="primary" size="lg" disabled={!canSubmit} loading={create.isPending} onClick={submit}>
              Assign{targetCount ? ` to ${targetCount}` : ''}
            </Button>
            {create.isError && (
              <p className="small text-err" role="alert">
                {create.error.message}
              </p>
            )}
            <p className="xs subtle">Every assignment is recorded in the audit log with who assigned it.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
