import { Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, ClipboardList, Download, GraduationCap, Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMe } from '@/api/client';
import { downloadCsv, useTeamDashboard } from '@/api/platform';
import type { AtRiskItem, DashboardMember, TeamDashboard } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { initials } from '@/app/Shell';
import { useShell } from '@/app/shell-context';
import { Columns, HeatCell } from '@/components/charts';
import { DomainIcon } from '@/components/domain';
import { FrameworkReadinessList } from '@/components/framework-picker';
import { AssignmentStateBadge, DueDate, ItemLink } from '@/components/platform';
import { Badge, Button, Card, EmptyState, ErrorState, PageSkeleton, Select, Stat, Tooltip } from '@/components/ui';
import { cn, formatMinutes, pct } from '@/lib/utils';
import { teamRoute } from '@/router';

export function Team() {
  return (
    <RequireAccess path="/team">
      <TeamScreen />
    </RequireAccess>
  );
}

/** Picks the team from the URL, falling back to the first team the principal may view. */
export function useSelectedTeam(team: string | undefined) {
  const me = useMe();
  const teams = me.data?.managedTeams ?? [];
  const selected = team && teams.some((t) => t.id === team) ? team : teams[0]?.id;
  return { teams, selected, me: me.data };
}

function TeamScreen() {
  const search = teamRoute.useSearch();
  const navigate = useNavigate({ from: teamRoute.fullPath });
  const { teams, selected } = useSelectedTeam(search.team);
  const dash = useTeamDashboard(selected);
  const { toast } = useShell();
  const [exporting, setExporting] = useState(false);

  // Keep the URL in sync with the chosen team so links from this page carry it.
  useEffect(() => {
    if (selected && search.team !== selected) void navigate({ search: { team: selected }, replace: true });
  }, [selected, search.team, navigate]);

  if (dash.isPending || !selected) {
    return (
      <div className="page page-wide">
        <PageSkeleton />
      </div>
    );
  }
  if (dash.isError) {
    return (
      <div className="page">
        <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />
      </div>
    );
  }
  const d = dash.data;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(`/api/reports/progress.csv?team=${encodeURIComponent(d.team.id)}`, `${d.team.name.replace(/\s+/g, '-').toLowerCase()}-progress.csv`);
      toast({ title: 'Export ready', description: 'The progress report downloaded as CSV; the export is in the audit log.', tone: 'ok' });
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, tone: 'err' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page page-wide">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Team dashboard</div>
          <div className="row" style={{ gap: 12 }}>
            {teams.length > 1 ? (
              <Select aria-label="Team" value={d.team.id} onChange={(e) => void navigate({ search: { team: e.target.value } })} className="select-title">
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            ) : (
              <h1>{d.team.name}</h1>
            )}
          </div>
          <p className="muted">
            {d.totals.members} members · {d.totals.activeThisWeek} active this week · managed by {d.team.managers.map((m) => m.name).join(', ') || 'nobody yet'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="secondary" icon={<Download size={14} />} loading={exporting} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
          <Link to="/team/exams" search={{ team: d.team.id }} className="btn btn-secondary btn-md">
            <GraduationCap size={14} /> Exams
          </Link>
          <Link to="/team/assignments" search={{ team: d.team.id }} className="btn btn-secondary btn-md">
            <ClipboardList size={14} /> Assignments
          </Link>
          <Link to="/team/assign" search={{ team: d.team.id }} className="btn btn-primary btn-md">
            <Plus size={14} /> Assign
          </Link>
        </div>
      </header>

      {d.source === 'empty' ? (
        <EmptyState icon={<Users size={20} />} title="No activity in this team yet" description="The heatmap fills in as members complete labs. Assign a path to get them started." action={<Link to="/team/assign" search={{ team: d.team.id }} className="btn btn-primary btn-md">Assign a path</Link>} />
      ) : (
        <>
          <div className="stat-row" style={{ marginBottom: 20 }}>
            <Stat label="Practice this month" value={formatMinutes(d.totals.minutesThisMonth)} hint={`${formatMinutes(d.members.reduce((a, m) => a + m.minutesThisWeek, 0))} in the last 7 days`} />
            <Stat label="Completion" value={pct(d.totals.completionRate)} hint="of assigned work" />
            <Stat label="Overdue" value={d.totals.assignmentsOverdue} tone={d.totals.assignmentsOverdue ? 'warn' : undefined} hint="assignments" />
            <Stat label="At risk" value={d.atRisk.length} tone={d.atRisk.length ? 'warn' : undefined} hint="people × items" />
            <Stat label="Members" value={d.totals.members} hint={`${d.members.filter((m) => m.role === 'manager').length} ${d.members.filter((m) => m.role === 'manager').length === 1 ? 'manager' : 'managers'}`} />
          </div>

          <Heatmap d={d} />

          <div className="split split-5-7" style={{ marginTop: 20 }}>
            <div className="stack" style={{ gap: 20 }}>
              <Card className="card-flush">
                <div className="card-head">
                  <h2>Framework readiness</h2>
                  <span className="subtle xs">team mean · members ≥ 70%</span>
                </div>
                <FrameworkReadinessList
                  rows={d.frameworks.map((f) => ({
                    id: f.frameworkId,
                    readiness: f.readiness,
                    tone: f.readiness < 0.45 ? 'neutral' : 'accent',
                    label: (
                      <span>
                        {f.name}
                        <span className="subtle xs">
                          {' '}
                          · {f.ready} of {f.members} ready
                        </span>
                      </span>
                    ),
                  }))}
                />
              </Card>
              <Card className="card-flush">
                <div className="card-head">
                  <h2>Practice minutes</h2>
                  <span className="subtle xs" title="Graded time: from opening a lab to its last Validate, as learners see it on Home">
                    per week, last 8 weeks
                  </span>
                </div>
                <div style={{ padding: '14px 20px 16px' }}>
                  <Columns values={d.minutesByWeek.map((w) => ({ label: w.weekStart.slice(5), value: w.minutes }))} height={120} format={(v) => formatMinutes(v)} />
                </div>
              </Card>
            </div>

            <Card className="card-flush">
              <div className="card-head">
                <h2>At risk</h2>
                <span className="subtle xs">overdue, due soon and untouched, or stalled required work</span>
              </div>
              {d.atRisk.length === 0 ? (
                <p className="small muted" style={{ padding: '16px 20px' }}>
                  Nobody is behind. Deadlines inside three days with no progress will show up here.
                </p>
              ) : (
                <ul className="risk-list">
                  {d.atRisk.map((r) => (
                    <RiskRow key={`${r.user.id}-${r.assignmentId}`} r={r} teamId={d.team.id} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

const riskReason: Record<AtRiskItem['reason'], string> = { overdue: 'Overdue', due_soon_not_started: 'Due soon, not started', stalled: 'Stalled' };

function RiskRow({ r, teamId }: { r: AtRiskItem; teamId: string }) {
  return (
    <li className="risk-row">
      <Link to="/team/members/$userId" params={{ userId: r.user.id }} search={{ team: teamId }} className="member-cell" style={{ minWidth: 0 }}>
        <span className="avatar" aria-hidden>
          {initials(r.user.name)}
        </span>
        <span className="stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="small truncate" style={{ fontWeight: 500 }}>
            {r.user.name}
          </span>
          <span className="xs subtle truncate">{r.user.title}</span>
        </span>
      </Link>
      <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
        <ItemLink item={r.item} className="small truncate link-strong" />
        <DueDate dueAt={r.dueAt} />
      </span>
      <Badge tone={r.reason === 'overdue' ? 'warn' : 'neutral'}>
        {r.reason === 'overdue' && <AlertTriangle size={10} />} {riskReason[r.reason]}
      </Badge>
    </li>
  );
}

function Heatmap({ d }: { d: TeamDashboard }) {
  const { members, competencies } = d;
  const mean = (cid: string) => {
    const vals = members.map((m) => m.mastery[cid]).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return (
    <Card className="card-flush">
      <div className="card-head">
        <h2>Members × competencies</h2>
        <span className="subtle xs">Mean mastery per competency; open a member for skills, attempts and assignments</span>
      </div>
      <div className="team-heat-wrap">
        <table className="team-heat">
          <thead>
            <tr>
              <th scope="col" className="team-heat-corner">
                <span className="sr-only">Member</span>
              </th>
              {competencies.map((c) => (
                <th key={c.id} scope="col">
                  <Tooltip content={`${c.name} · ${c.domain}`} side="top">
                    <span className="team-heat-col" lang="en">
                      <DomainIcon domain={c.domain} size={11} />
                      <span className="truncate">{c.name}</span>
                    </span>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user.id}>
                <th scope="row">
                  <MemberCell m={m} teamId={d.team.id} />
                </th>
                {competencies.map((c) => {
                  const v = m.mastery[c.id];
                  return (
                    <td key={c.id}>
                      {typeof v === 'number' ? (
                        <HeatCell value={v} className="team-heat-cell" title={`${m.user.name} · ${c.name} · ${pct(v)}`} aria-label={`${m.user.name}, ${c.name}: ${pct(v)}`}>
                          <span className="tnum">{Math.round(v * 100)}</span>
                        </HeatCell>
                      ) : (
                        <div className="team-heat-cell team-heat-empty" title={`${m.user.name} · ${c.name} · no evidence`} aria-label={`${m.user.name}, ${c.name}: no evidence`}>
                          ·
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="team-heat-mean">
              <th scope="row" className="xs subtle" style={{ textAlign: 'left', paddingLeft: 12 }}>
                Team mean
              </th>
              {competencies.map((c) => {
                const v = mean(c.id);
                return (
                  <td key={c.id} className={cn('xs tnum', v !== null && v < 0.4 && 'text-warn')} style={{ textAlign: 'center' }}>
                    {v === null ? '—' : Math.round(v * 100)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MemberCell({ m, teamId }: { m: DashboardMember; teamId: string }) {
  return (
    <Link to="/team/members/$userId" params={{ userId: m.user.id }} search={{ team: teamId }} className="member-cell" title={`${m.user.name} · ${m.user.title ?? ''} · ${formatMinutes(m.minutesThisMonth)} practice this month`}>
      <span className="avatar" aria-hidden>
        {initials(m.user.name)}
      </span>
      <span className="stack" style={{ gap: 0, minWidth: 0 }}>
        <span className="small truncate row" style={{ fontWeight: 500, gap: 6 }}>
          {m.user.name}
          {m.atRisk && (
            <span title="At risk" className="text-warn" aria-label="at risk">
              <AlertTriangle size={11} />
            </span>
          )}
        </span>
        <span className="xs subtle truncate">
          {m.user.title} · {formatMinutes(m.minutesThisMonth)} this month
        </span>
      </span>
      <ArrowRight size={12} className="subtle member-cell-arrow" />
    </Link>
  );
}

export { AssignmentStateBadge };
