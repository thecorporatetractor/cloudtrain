import { Link } from '@tanstack/react-router';
import { ArrowRight, KeyRound, UserPlus, Users } from 'lucide-react';
import { useAdminOverview } from '@/api/platform';
import { RequireAccess } from '@/app/access';
import { Bar } from '@/components/charts';
import { When } from '@/components/platform';
import { Card, ErrorState, Meter, PageSkeleton, Stat } from '@/components/ui';
import { pct } from '@/lib/utils';
import { auditActionLabel } from './Audit';

export function AdminOverview() {
  return (
    <RequireAccess path="/admin/users">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const q = useAdminOverview();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const hoursShare = d.quotas.monthlyLabHours ? d.labHoursThisMonth / d.quotas.monthlyLabHours : 0;
  const sessionsShare = d.quotas.maxConcurrentSessions ? d.runningSessions / d.quotas.maxConcurrentSessions : 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stat-row">
        <Stat label="Active users" value={d.users.active} hint={`${d.users.activeLast7d} signed in this week`} />
        <Stat label="Invited" value={d.users.invited} hint={`${d.users.deactivated} deactivated`} />
        <Stat label="Teams" value={d.teams} />
        <Stat label="Running sessions" value={d.runningSessions} hint={`of ${d.quotas.maxConcurrentSessions} concurrent`} tone={sessionsShare > 0.85 ? 'warn' : undefined} />
        <Stat label="Lab hours this month" value={Math.round(d.labHoursThisMonth)} hint={`of ${d.quotas.monthlyLabHours} h`} tone={hoursShare > 0.85 ? 'warn' : undefined} />
        <Stat label="SSO" value={d.ssoConnections ? `${d.ssoConnections} connection${d.ssoConnections === 1 ? '' : 's'}` : 'Off'} hint={d.org.settings.allowLocalLogin ? 'local passwords allowed' : 'enforced'} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 7fr)', gap: 20, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Quota</h2>
              <Link to="/admin/usage" search={{}} className="link-quiet small">
                Usage <ArrowRight size={12} />
              </Link>
            </div>
            <div className="card-body stack" style={{ gap: 14 }}>
              <div className="stack" style={{ gap: 5 }}>
                <div className="row-between small">
                  <span>Lab hours · month to date</span>
                  <span className="tnum">
                    {Math.round(d.labHoursThisMonth)} / {d.quotas.monthlyLabHours} h · {pct(hoursShare)}
                  </span>
                </div>
                <Meter value={hoursShare} tone={hoursShare > 0.85 ? 'warn' : 'accent'} label="Lab hours used" />
              </div>
              <div className="stack" style={{ gap: 5 }}>
                <div className="row-between small">
                  <span>Concurrent sessions · now</span>
                  <span className="tnum">
                    {d.runningSessions} / {d.quotas.maxConcurrentSessions}
                  </span>
                </div>
                <Bar value={sessionsShare} tone={sessionsShare > 0.85 ? 'warn' : 'accent'} />
              </div>
              <div className="xs subtle">Sessions are capped at {d.quotas.maxSessionMinutes} minutes; the default is {d.org.settings.defaultSessionMinutes}.</div>
            </div>
          </Card>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Quick actions</h2>
            </div>
            <ul className="action-list">
              <li>
                <Link to="/admin/users" search={{ invite: true }} className="action-row">
                  <UserPlus size={15} /> <span className="grow">Invite someone</span> <ArrowRight size={12} className="subtle" />
                </Link>
              </li>
              <li>
                <Link to="/admin/teams" search={{}} className="action-row">
                  <Users size={15} /> <span className="grow">Manage teams and managers</span> <ArrowRight size={12} className="subtle" />
                </Link>
              </li>
              <li>
                <Link to="/admin/sso" search={{}} className="action-row">
                  <KeyRound size={15} /> <span className="grow">{d.ssoConnections ? 'Review SSO connections' : 'Set up single sign-on'}</span> <ArrowRight size={12} className="subtle" />
                </Link>
              </li>
            </ul>
          </Card>
        </div>

        <Card className="card-flush">
          <div className="card-head">
            <h2>Recent activity</h2>
            <Link to="/admin/audit" search={{}} className="link-quiet small">
              Audit log <ArrowRight size={12} />
            </Link>
          </div>
          <ul className="activity">
            {d.recentAudit.map((e) => (
              <li key={e.id} className="activity-row">
                <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
                  <span className="small truncate">
                    <strong>{e.actor?.name ?? 'System'}</strong> · {auditActionLabel(e.action)}
                    {e.targetLabel ? ` · ${e.targetLabel}` : ''}
                  </span>
                  <span className="xs subtle mono">{e.action}</span>
                </span>
                <span className="xs subtle tnum">
                  <When iso={e.at} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
