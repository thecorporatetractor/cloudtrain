import { Link } from '@tanstack/react-router';
import { AlertTriangle, CalendarClock, Users } from 'lucide-react';
import { useMemo } from 'react';
import { useSkills, useTeam } from '@/api/client';
import type { TeamMember } from '@/api/types';
import { HeatCell } from '@/components/charts';
import { DomainIcon } from '@/components/domain';
import { initials } from '@/app/Shell';
import { Badge, Card, ErrorState, PageSkeleton, Stat, Tooltip } from '@/components/ui';
import { cn, daysUntil, formatDate, formatMinutes, pct } from '@/lib/utils';

export function Team() {
  const team = useTeam();
  const skills = useSkills();

  const stats = useMemo(() => {
    if (!team.data) return null;
    const { members, competencies } = team.data;
    const all = members.flatMap((m) => competencies.map((c) => m.skills[c.id] ?? 0));
    const avg = all.reduce((a, b) => a + b, 0) / all.length;
    const certs = members.flatMap((m) => m.certs.map((c) => ({ ...c, member: m })));
    const atRisk = certs.filter((c) => new Date(c.forecast) > new Date(c.deadline));
    const minutes = members.reduce((a, m) => a + m.minutesThisMonth, 0);
    const weakest = competencies
      .map((c) => ({ c, mean: members.reduce((a, m) => a + (m.skills[c.id] ?? 0), 0) / members.length }))
      .sort((a, b) => a.mean - b.mean)[0];
    return { avg, certs: certs.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()), atRisk, minutes, weakest };
  }, [team.data]);

  if (team.isPending) {
    return (
      <div className="page page-wide">
        <PageSkeleton />
      </div>
    );
  }
  if (team.isError || !stats) {
    return (
      <div className="page">
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      </div>
    );
  }
  const { team: t, members, competencies, workshops } = team.data;
  const frameworkName = (id: string) => skills.data?.frameworks.find((f) => f.id === id)?.name ?? id.toUpperCase();

  return (
    <div className="page page-wide">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Team</div>
          <h1>{t.name}</h1>
          <p className="muted">
            {members.length} members · managed by {t.manager}
          </p>
        </div>
        <div className="row" style={{ gap: 28 }}>
          <Stat label="Mean mastery" value={pct(stats.avg)} hint={`weakest: ${stats.weakest?.c.name ?? '—'}`} />
          <Stat label="At-risk certs" value={stats.atRisk.length} tone={stats.atRisk.length ? 'warn' : undefined} hint={`${stats.certs.length} scheduled`} />
          <Stat label="This month" value={formatMinutes(stats.minutes)} hint="hands-on time" />
        </div>
      </header>

      <Card className="card-flush" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <h2>Team × competency</h2>
          <span className="subtle xs">Mean mastery per competency; click a name to open their skills</span>
        </div>
        <div className="team-heat-wrap">
          <table className="team-heat" role="grid">
            <thead>
              <tr>
                <th scope="col" className="team-heat-corner">
                  <span className="sr-only">Member</span>
                </th>
                {competencies.map((c) => (
                  <th key={c.id} scope="col">
                    <Tooltip content={`${c.name} · ${c.domain}`} side="top">
                      <span className="team-heat-col">
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
                <tr key={m.id}>
                  <th scope="row">
                    <MemberCell m={m} />
                  </th>
                  {competencies.map((c) => {
                    const v = m.skills[c.id] ?? 0;
                    return (
                      <td key={c.id}>
                        <HeatCell value={v} className="team-heat-cell" title={`${m.name} · ${c.name} · ${pct(v)}`} aria-label={`${m.name}, ${c.name}: ${pct(v)}`}>
                          <span className="tnum">{Math.round(v * 100)}</span>
                        </HeatCell>
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
                  const mean = members.reduce((a, m) => a + (m.skills[c.id] ?? 0), 0) / members.length;
                  return (
                    <td key={c.id} className={cn('xs tnum', mean < 0.4 && 'text-warn')} style={{ textAlign: 'center' }}>
                      {Math.round(mean * 100)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 7fr)', gap: 20 }}>
        <Card className="card-flush">
          <div className="card-head">
            <h2>Certification deadlines</h2>
            <span className="subtle xs">forecast vs booked date</span>
          </div>
          <ul className="cert-list">
            {stats.certs.map((c) => {
              const late = new Date(c.forecast) > new Date(c.deadline);
              const days = daysUntil(c.deadline);
              const slipDays = Math.round((new Date(c.forecast).getTime() - new Date(c.deadline).getTime()) / 86_400_000);
              return (
                <li key={`${c.member.id}-${c.frameworkId}`} className="cert-row">
                  <span className="avatar" aria-hidden>
                    {initials(c.member.name)}
                  </span>
                  <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                    <span className="row small" style={{ gap: 8 }}>
                      <span className="truncate" style={{ fontWeight: 500 }}>
                        {c.member.name}
                      </span>
                      <Badge tone="outline">{frameworkName(c.frameworkId)}</Badge>
                    </span>
                    <span className="xs subtle row" style={{ gap: 6 }}>
                      <CalendarClock size={11} /> {formatDate(c.deadline)} · {days} days · ready {pct(c.readiness)}
                    </span>
                  </span>
                  {late ? (
                    <Badge tone="warn">
                      <AlertTriangle size={10} /> {slipDays}d late
                    </Badge>
                  ) : (
                    <Badge tone="ok">{-slipDays}d margin</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="card-flush">
          <div className="card-head">
            <h2>Suggested workshops</h2>
            <span className="subtle xs">generated from gaps × deadlines</span>
          </div>
          <ul className="workshop-list">
            {workshops.map((w) => {
              const comp = competencies.find((c) => c.id === w.competencyId);
              return (
                <li key={w.id} className="workshop">
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div className="stack" style={{ gap: 3 }}>
                      <h3>{w.title}</h3>
                      <div className="xs subtle row" style={{ gap: 8 }}>
                        {comp && (
                          <span className="row" style={{ gap: 4 }}>
                            <DomainIcon domain={comp.domain} size={11} /> {comp.name}
                          </span>
                        )}
                        <span>{formatMinutes(w.durationMinutes)}</span>
                        <span className="row" style={{ gap: 4 }}>
                          <Users size={11} /> {w.memberIds.length}
                        </span>
                      </div>
                    </div>
                    <div className="avatar-stack" aria-label={`${w.memberIds.length} attendees`}>
                      {w.memberIds.slice(0, 5).map((id) => {
                        const m = members.find((x) => x.id === id);
                        return (
                          <span key={id} className="avatar" title={m?.name}>
                            {initials(m?.name ?? '')}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <p className="small muted" style={{ marginTop: 8 }}>
                    {w.reason}
                  </p>
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <button className="btn btn-secondary btn-sm">Schedule</button>
                    <button className="btn btn-ghost btn-sm">Dismiss</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function MemberCell({ m }: { m: TeamMember }) {
  return (
    <Link to="/skills" search={{ framework: m.certs[0]?.frameworkId ?? 'cks' }} className="member-cell">
      <span className="avatar" aria-hidden>
        {initials(m.name)}
      </span>
      <span className="stack" style={{ gap: 0, minWidth: 0 }}>
        <span className="small truncate" style={{ fontWeight: 500 }}>
          {m.name}
        </span>
        <span className="xs subtle truncate">
          {m.title} · {formatMinutes(m.minutesThisMonth)}
        </span>
      </span>
    </Link>
  );
}
