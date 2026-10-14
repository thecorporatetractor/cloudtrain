import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAssignment, useAssignments, useDeleteAssignment } from '@/api/platform';
import type { Assignment, AssignmentState } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { Bar } from '@/components/charts';
import { AssignmentStateBadge, DueDate, ItemLink, UserCell, When, assignmentStateMeta, itemKindLabel } from '@/components/platform';
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Segmented, Skeleton, TableSkeleton, TableWrap } from '@/components/ui';
import { pct } from '@/lib/utils';
import { teamAssignmentsRoute } from '@/router';
import { useSelectedTeam } from './Team';

const STATES: AssignmentState[] = ['not_started', 'in_progress', 'completed', 'overdue'];

export function TeamAssignments() {
  return (
    <RequireAccess path="/team">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const search = teamAssignmentsRoute.useSearch();
  const navigate = useNavigate({ from: teamAssignmentsRoute.fullPath });
  const { selected } = useSelectedTeam(search.team);
  const q = useAssignments({ team: selected, state: search.state, limit: 100 });
  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return (
    <div className="page">
      <Link to="/team" search={{ team: selected }} className="link-quiet small" style={{ marginBottom: 14 }}>
        <ChevronLeft size={13} /> Team dashboard
      </Link>
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Manager</div>
          <h1>Assignments</h1>
          <p className="muted">Everything assigned to this team and its members, with who is where.</p>
        </div>
        <Link to="/team/assign" search={{ team: selected }} className="btn btn-primary btn-md">
          <Plus size={14} /> Assign
        </Link>
      </header>

      <div className="row-between" style={{ marginBottom: 14 }}>
        <Segmented<string> label="State" value={search.state ?? 'all'} onChange={(v) => set({ state: v === 'all' ? undefined : v })} options={[{ value: 'all', label: 'All' }, ...STATES.map((s) => ({ value: s, label: assignmentStateMeta[s].label }))]} />
        {q.data && <span className="xs subtle tnum">{q.data.items.length} assignments</span>}
      </div>

      {q.isPending ? (
        <TableSkeleton cols={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={<ClipboardList size={20} />} title="No assignments" description="Assign a lab or path to the team to see progress here." action={<Link to="/team/assign" search={{ team: selected }} className="btn btn-primary btn-md">Assign</Link>} />
      ) : (
        <Card className="card-flush">
          <TableWrap>
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">To</th>
                  <th scope="col">Due</th>
                  <th scope="col" style={{ width: 200 }}>
                    Progress
                  </th>
                  <th scope="col">Assigned</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((a) => (
                  <tr key={a.id} className="row-link" tabIndex={0} onClick={() => set({ open: a.id })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), set({ open: a.id }))} aria-label={`Open ${a.item.title}`}>
                    <td>
                      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                        <span className="row" style={{ gap: 8 }}>
                          <span className="small truncate" style={{ fontWeight: 500 }}>
                            {a.item.title}
                          </span>
                          {a.required && <Badge tone="outline">Required</Badge>}
                        </span>
                        <span className="xs subtle">
                          {itemKindLabel[a.item.kind]}
                          {a.item.labIds && a.item.kind !== 'lab' ? ` · ${a.item.labIds.length} labs` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="small">
                      {a.target.name ?? a.target.id}
                      <div className="xs subtle">{a.target.kind}</div>
                    </td>
                    <td>
                      <DueDate dueAt={a.dueAt} />
                    </td>
                    <td>
                      <CountsBar a={a} />
                    </td>
                    <td className="small">
                      {a.assignedBy.name}
                      <div className="xs subtle">
                        <When iso={a.createdAt} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <AssignmentDrawer id={search.open} onClose={() => set({ open: undefined })} />
    </div>
  );
}

function CountsBar({ a }: { a: Assignment }) {
  const total = Object.values(a.counts).reduce((s, n) => s + n, 0) || 1;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="counts-bar" aria-label={`${a.counts.completed} completed, ${a.counts.in_progress} in progress, ${a.counts.overdue} overdue, ${a.counts.not_started} not started`}>
        <span className="counts-seg counts-ok" style={{ width: `${(a.counts.completed / total) * 100}%` }} />
        <span className="counts-seg counts-accent" style={{ width: `${(a.counts.in_progress / total) * 100}%` }} />
        <span className="counts-seg counts-warn" style={{ width: `${(a.counts.overdue / total) * 100}%` }} />
      </div>
      <span className="xs subtle tnum">
        {a.counts.completed} done · {a.counts.in_progress} going · {a.counts.overdue} late · {a.counts.not_started} new
      </span>
    </div>
  );
}

function AssignmentDrawer({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const q = useAssignment(id);
  const remove = useDeleteAssignment();
  const { toast } = useShell();
  const [confirm, setConfirm] = useState(false);
  const a = q.data?.assignment;
  return (
    <Drawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={a?.item.title ?? 'Assignment'}
      description={a ? `${itemKindLabel[a.item.kind]} · to ${a.target.name} · by ${a.assignedBy.name}` : undefined}
      width={560}
      actions={
        a && (
          <>
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setConfirm(true)}>
              Remove assignment
            </Button>
            <ItemLink item={a.item} className="btn btn-secondary btn-sm" />
          </>
        )
      }
    >
      {q.isPending ? (
        <Skeleton h={160} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <DueDate dueAt={q.data.assignment.dueAt} />
            {q.data.assignment.required && <Badge tone="outline">Required</Badge>}
            {q.data.assignment.note && <span className="small muted">“{q.data.assignment.note}”</span>}
          </div>
          <CountsBar a={q.data.assignment} />
          <div>
            <div className="task-h">People</div>
            {q.data.statuses.length === 0 ? (
              <p className="small muted">Status rows appear once the gateway computes them for this assignment.</p>
            ) : (
              <ul className="due-list due-list-flush">
                {q.data.statuses.map((s) => (
                  <li key={s.user.id} className="due-row">
                    <UserCell user={s.user} sub={s.user.title} size="sm" />
                    <span style={{ width: 90 }}>
                      <Bar value={s.progress} thin tone={s.status === 'completed' ? 'ok' : 'accent'} />
                    </span>
                    <span className="xs subtle tnum" style={{ width: 32, textAlign: 'right' }}>
                      {pct(s.progress)}
                    </span>
                    <AssignmentStateBadge state={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove this assignment?"
        description="It disappears from everyone's list. Attempts and skill evidence are kept."
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onConfirm={() =>
          a &&
          remove.mutate(a.id, {
            onSuccess: () => {
              setConfirm(false);
              onClose();
              toast({ title: 'Assignment removed', tone: 'neutral' });
            },
            onError: (e) => toast({ title: 'Could not remove', description: e.message, tone: 'err' }),
          })
        }
      />
    </Drawer>
  );
}
