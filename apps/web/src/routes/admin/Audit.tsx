import { useNavigate } from '@tanstack/react-router';
import { Download, ScrollText, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { downloadCsv, useAudit } from '@/api/platform';
import type { AuditEvent } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { When } from '@/components/platform';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Input, Pager, Select, TableSkeleton, TableWrap, Toolbar } from '@/components/ui';
import { usePageCursor } from '@/lib/paging';
import { adminAuditRoute } from '@/router';

const PAGE = 20;
const AREAS = ['auth.', 'user.', 'team.', 'assignment.', 'cohort.', 'session.', 'sso.', 'domain.', 'content.', 'quota.', 'settings.', 'report.', 'audit.', 'platform.'];
const TARGETS = ['user', 'team', 'assignment', 'cohort', 'session', 'sso', 'domain', 'lab', 'pack', 'org'];

/** "session.observe" -> "Observed a session". Good enough for the overview and the table; details keep the raw action. */
export function auditActionLabel(action: string): string {
  const [area, verb = ''] = action.split('.');
  const verbs: Record<string, string> = { login: 'Signed in', logout: 'Signed out', login_denied: 'Sign-in denied', switch: 'Switched organisation', invite: 'Invited', update: 'Updated', deactivate: 'Deactivated', reactivate: 'Reactivated', revoke: 'Revoked', create: 'Created', delete: 'Deleted', member_add: 'Added a member to', member_remove: 'Removed a member from', export: 'Exported', broadcast: 'Broadcast to', observe: 'Observed', extend: 'Extended', reset: 'Reset', terminate: 'Terminated', test: 'Tested', add: 'Added', verify: 'Verified', remove: 'Removed', visibility: 'Changed visibility of', org_create: 'Created org', org_update: 'Updated org', org_suspend: 'Suspended org', org_reactivate: 'Reactivated org', org_delete: 'Deleted org' };
  const v = verbs[verb] ?? verb.replace(/_/g, ' ');
  const nouns: Record<string, string> = { auth: '', user: 'user', team: 'team', assignment: 'assignment', cohort: 'cohort', session: 'session', sso: 'SSO connection', domain: 'domain', content: 'content', quota: 'quotas', settings: 'settings', report: 'report', audit: 'audit log', platform: '' };
  const n = nouns[area ?? ''] ?? area;
  return n && !v.toLowerCase().includes(n) ? `${v} ${n}` : v;
}

export function AdminAudit() {
  return (
    <RequireAccess path="/admin/audit">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const search = adminAuditRoute.useSearch();
  const navigate = useNavigate({ from: adminAuditRoute.fullPath });
  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const pages = usePageCursor(JSON.stringify([search.action, search.actor, search.targetType, search.from, search.to]), search.page ?? 1);
  const page = pages.page;
  const [actor, setActor] = useState(search.actor ?? '');
  useEffect(() => {
    const t = window.setTimeout(() => actor !== (search.actor ?? '') && set({ actor: actor || undefined, page: undefined }), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor]);
  const q = useAudit({ action: search.action, actor: search.actor, targetType: search.targetType, from: search.from, to: search.to, cursor: pages.cursor, limit: PAGE });
  pages.useRemember(q.data?.nextCursor);
  const { toast } = useShell();
  const [exporting, setExporting] = useState(false);
  const hasFilter = !!(search.action || search.actor || search.targetType || search.from || search.to);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries({ action: search.action, actor: search.actor, targetType: search.targetType, from: search.from, to: search.to })) if (v) params.set(k, v);
      await downloadCsv(`/api/admin/audit.csv${params.size ? `?${params}` : ''}`, `audit-${new Date().toISOString().slice(0, 10)}.csv`);
      toast({ title: 'Audit log exported', description: 'The export itself is recorded.', tone: 'ok' });
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, tone: 'err' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Toolbar
        end={
          <Button variant="secondary" icon={<Download size={14} />} loading={exporting} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        }
      >
        <label className="search-field" style={{ width: 200 }}>
          <Search size={13} aria-hidden />
          <input className="search-input" placeholder="Actor…" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by actor" />
          {actor && (
            <button type="button" className="link-quiet" aria-label="Clear actor" onClick={() => setActor('')}>
              <X size={12} />
            </button>
          )}
        </label>
        <Select aria-label="Action" value={search.action ?? ''} onChange={(e) => set({ action: e.target.value || undefined, page: undefined })}>
          <option value="">Any action</option>
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {a.replace('.', '')}.*
            </option>
          ))}
        </Select>
        <Select aria-label="Target type" value={search.targetType ?? ''} onChange={(e) => set({ targetType: e.target.value || undefined, page: undefined })}>
          <option value="">Any target</option>
          {TARGETS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label="From" value={search.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined, page: undefined })} style={{ width: 150 }} />
        <Input type="date" aria-label="To" value={search.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined, page: undefined })} style={{ width: 150 }} />
        {hasFilter && (
          <Button variant="ghost" size="sm" icon={<X size={12} />} onClick={() => (setActor(''), set({ action: undefined, actor: undefined, targetType: undefined, from: undefined, to: undefined, page: undefined }))}>
            Clear
          </Button>
        )}
      </Toolbar>

      {q.isPending ? (
        <TableSkeleton cols={5} rows={10} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={<ScrollText size={20} />} title="No events match" description="Widen the date range or clear a filter." />
      ) : (
        <Card className="card-flush">
          <TableWrap compact>
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((e) => (
                  <tr key={e.id} className="row-link" tabIndex={0} onClick={() => set({ event: e.id })} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), set({ event: e.id }))} aria-label={`Open event ${e.action}`}>
                    <td className="small tnum" style={{ whiteSpace: 'nowrap' }}>
                      <When iso={e.at} />
                    </td>
                    <td className="small">{e.actor?.name ?? <span className="subtle">system</span>}</td>
                    <td>
                      <span className="stack" style={{ gap: 0 }}>
                        <span className="small">{auditActionLabel(e.action)}</span>
                        <span className="xs subtle mono">{e.action}</span>
                      </span>
                    </td>
                    <td className="small">
                      <span className="row" style={{ gap: 6 }}>
                        <Badge tone="outline">{e.targetType}</Badge>
                        <span className="truncate" style={{ maxWidth: 320 }}>
                          {e.targetLabel ?? e.targetId}
                        </span>
                      </span>
                    </td>
                    <td className="xs subtle mono">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="card-foot">
            <Pager offset={(page - 1) * PAGE} pageSize={PAGE} total={q.data.total} hasNext={!!q.data.nextCursor} loading={q.isFetching} onChange={(o) => set({ page: o / PAGE + 1 || undefined })} />
          </div>
        </Card>
      )}
      <EventDrawer event={q.data?.items.find((e) => e.id === search.event)} open={!!search.event} onClose={() => set({ event: undefined })} />
    </div>
  );
}

function EventDrawer({ event, open, onClose }: { event: AuditEvent | undefined; open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} title={event ? auditActionLabel(event.action) : 'Event'} description={event ? `${event.actor?.name ?? 'System'} · ${new Date(event.at).toLocaleString()}` : undefined} width={520}>
      {event && (
        <div className="stack" style={{ gap: 16 }}>
          <dl className="summary-list summary-list-mono">
            <dt>Action</dt>
            <dd>{event.action}</dd>
            <dt>Actor</dt>
            <dd>{event.actor ? `${event.actor.name} <${event.actor.email}>` : 'system'}</dd>
            <dt>Target</dt>
            <dd>
              {event.targetType}:{event.targetId}
              {event.targetLabel ? ` (${event.targetLabel})` : ''}
            </dd>
            <dt>IP</dt>
            <dd>{event.ip ?? '—'}</dd>
            <dt>Event id</dt>
            <dd>{event.id}</dd>
          </dl>
          <div>
            <div className="task-h">Details</div>
            <pre className="prose-code" style={{ margin: 0 }}>
              {JSON.stringify(event.details, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </Drawer>
  );
}
