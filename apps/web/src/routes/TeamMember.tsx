import { Link } from '@tanstack/react-router';
import { ArrowRight, ChevronLeft, Plus } from 'lucide-react';
import { useSkills } from '@/api/client';
import { useMember, useTeamDashboard } from '@/api/platform';
import { RequireAccess } from '@/app/access';
import { initials } from '@/app/Shell';
import { HeatCell } from '@/components/charts';
import { FrameworkIcon, FrameworkReadinessList } from '@/components/framework-picker';
import { AssignmentStateBadge, DueDate, ItemLink, OutcomeBadge, When, itemKindLabel } from '@/components/platform';
import { Badge, Card, EmptyState, ErrorState, PageSkeleton, Stat, TableWrap } from '@/components/ui';
import { formatDuration, formatMinutes, pct } from '@/lib/utils';
import { teamMemberRoute } from '@/router';
import { useSelectedTeam } from './Team';

export function TeamMember() {
  return (
    <RequireAccess path="/team">
      <MemberScreen />
    </RequireAccess>
  );
}

function MemberScreen() {
  const { userId } = teamMemberRoute.useParams();
  const search = teamMemberRoute.useSearch();
  const { selected } = useSelectedTeam(search.team);
  const q = useMember(selected ?? '', userId);
  const dash = useTeamDashboard(selected);
  const skills = useSkills();

  if (q.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="page">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  const competencies = dash.data?.competencies ?? [];
  const frameworks = skills.data?.frameworks ?? [];
  // Highest readiness first: the set grows with the curriculum, so the stat row shows the top two.
  const top = [...frameworks].sort((a, b) => (d.readiness[b.id] ?? 0) - (d.readiness[a.id] ?? 0));
  const passed = d.attempts.filter((a) => a.outcome === 'passed').length;

  return (
    <div className="page">
      <Link to="/team" search={{ team: d.team.id }} className="link-quiet small" style={{ marginBottom: 14 }}>
        <ChevronLeft size={13} /> {d.team.name}
      </Link>
      <header className="page-header">
        <div className="row" style={{ gap: 16 }}>
          <span className="avatar avatar-xl" aria-hidden>
            {initials(d.user.name)}
          </span>
          <div>
            <div className="page-eyebrow">{d.role === 'manager' ? 'Team manager' : 'Team member'}</div>
            <h1>{d.user.name}</h1>
            <p className="muted">
              {d.user.title} · {d.user.email} · last signed in <When iso={d.user.lastLoginAt} />
            </p>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/skills" search={{ framework: top[0]?.id ?? 'cks', member: d.user.id }} className="btn btn-secondary btn-md">
            Skills <ArrowRight size={13} />
          </Link>
          <Link to="/team/assign" search={{ team: d.team.id, user: d.user.id }} className="btn btn-primary btn-md">
            <Plus size={14} /> Assign
          </Link>
        </div>
      </header>

      <div className="stat-row" style={{ marginBottom: 20 }}>
        <Stat label="This week" value={formatMinutes(d.minutesThisWeek)} hint="practice, last 7 days" />
        <Stat label="This month" value={formatMinutes(d.minutesThisMonth)} hint="practice" />
        <Stat label="Attempts" value={d.attempts.length} hint={`${passed} passed`} />
        <Stat label="Assignments" value={d.assignments.filter((a) => a.status !== 'completed').length} hint={`${d.assignments.filter((a) => a.status === 'overdue').length} overdue`} tone={d.assignments.some((a) => a.status === 'overdue') ? 'warn' : undefined} />
        {top.slice(0, 2).map((f) => (
          <Stat key={f.id} label={`${f.name} ready`} value={pct(d.readiness[f.id] ?? 0)} />
        ))}
      </div>

      <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Competencies</h2>
              <span className="subtle xs">average of practised skills</span>
            </div>
            <div className="heat-cells" style={{ padding: 14 }}>
              {Object.entries(d.mastery).map(([cid, v]) => {
                const meta = competencies.find((c) => c.id === cid);
                return (
                  <HeatCell key={cid} value={v ?? 0} title={`${meta?.name ?? cid} · ${v === null ? 'no evidence' : pct(v)}`}>
                    <span className="heat-name">{meta ? meta.name : cid}</span>
                    <span className="heat-mu tnum">{v === null ? '—' : Math.round(v * 100)}</span>
                  </HeatCell>
                );
              })}
            </div>
          </Card>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Framework readiness</h2>
            </div>
            <FrameworkReadinessList
              rows={frameworks.map((f) => ({
                id: f.id,
                readiness: d.readiness[f.id] ?? 0,
                label: (
                  <span className="row" style={{ gap: 6, minWidth: 0 }}>
                    <FrameworkIcon framework={f} size={12} /> {f.name}
                    <span className="subtle xs truncate">{f.fullName}</span>
                  </span>
                ),
              }))}
            />
          </Card>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Assignments</h2>
              <span className="subtle xs">{d.assignments.length} total</span>
            </div>
            {d.assignments.length === 0 ? (
              <EmptyState compact title="Nothing assigned" description="Assign a lab or path with a due date." />
            ) : (
              <ul className="due-list">
                {d.assignments.map((a) => (
                  <li key={a.id} className="due-row">
                    <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                      <span className="row" style={{ gap: 6 }}>
                        <ItemLink item={a.item} className="small truncate link-strong" />
                        {a.required && <Badge tone="outline">Required</Badge>}
                      </span>
                      <span className="row xs subtle" style={{ gap: 8 }}>
                        {itemKindLabel[a.item.kind]} · <DueDate dueAt={a.dueAt} done={a.status === 'completed'} />
                      </span>
                    </span>
                    <span className="xs tnum subtle" style={{ width: 36, textAlign: 'right' }}>
                      {pct(a.progress)}
                    </span>
                    <AssignmentStateBadge state={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="card-flush">
            <div className="card-head">
              <h2>Recent attempts</h2>
              <span className="subtle xs">last {Math.min(8, d.attempts.length)} of {d.attempts.length}</span>
            </div>
            {d.attempts.length === 0 ? (
              <EmptyState compact title="No attempts yet" />
            ) : (
              <TableWrap compact>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Lab</th>
                      <th scope="col">When</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Score</th>
                      <th scope="col" title="Practice time: from opening the lab to the last Validate">
                        Practice
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.attempts.slice(0, 8).map((a) => (
                      <tr key={a.id}>
                        <td className="small truncate" style={{ maxWidth: 220 }}>
                          <Link to="/labs/$labId" params={{ labId: a.labId }} className="link-strong">
                            {a.labTitle}
                          </Link>
                        </td>
                        <td className="small">
                          <When iso={a.startedAt} />
                        </td>
                        <td>
                          <OutcomeBadge outcome={a.outcome} />
                        </td>
                        <td className="small tnum">{a.outcome === 'abandoned' || a.validations === 0 ? '—' : a.score}</td>
                        <td className="small tnum" title={`Environment open ${formatDuration(a.durationS)}`}>
                          {a.practiceS ? formatDuration(a.practiceS) : <span className="subtle">not validated</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
