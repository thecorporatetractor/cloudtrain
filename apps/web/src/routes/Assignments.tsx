import { Link } from '@tanstack/react-router';
import { ClipboardList, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMyAssignments } from '@/api/platform';
import type { AssignmentState, MyAssignment } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { Bar } from '@/components/charts';
import { AssignmentStateBadge, DueDate, ItemLink, itemKindLabel } from '@/components/platform';
import { Badge, Card, EmptyState, ErrorState, Segmented, Stat, TableSkeleton, TableWrap } from '@/components/ui';
import { pct } from '@/lib/utils';

type Filter = 'open' | 'overdue' | 'required' | 'completed' | 'all';

export function Assignments() {
  return (
    <RequireAccess path="/assignments">
      <AssignmentsScreen />
    </RequireAccess>
  );
}

function AssignmentsScreen() {
  const q = useMyAssignments();
  const [filter, setFilter] = useState<Filter>('open');

  const stats = useMemo(() => {
    const all = q.data ?? [];
    const by = (s: AssignmentState) => all.filter((a) => a.status === s).length;
    return { open: all.filter((a) => a.status !== 'completed').length, overdue: by('overdue'), required: all.filter((a) => a.required && a.status !== 'completed').length, completed: by('completed') };
  }, [q.data]);

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const f: Record<Filter, (a: MyAssignment) => boolean> = {
      open: (a) => a.status !== 'completed',
      overdue: (a) => a.status === 'overdue',
      required: (a) => a.required && a.status !== 'completed',
      completed: (a) => a.status === 'completed',
      all: () => true,
    };
    const rank: Record<AssignmentState, number> = { overdue: 0, in_progress: 1, not_started: 2, completed: 3 };
    return all.filter(f[filter]).sort((a, b) => rank[a.status] - rank[b.status] || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  }, [q.data, filter]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Learner</div>
          <h1>My assignments</h1>
          <p className="muted">Labs, paths and frameworks assigned to you by your manager or instructor, with due dates.</p>
        </div>
        <div className="row" style={{ gap: 28 }}>
          <Stat label="Open" value={stats.open} />
          <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? 'warn' : undefined} />
          <Stat label="Required" value={stats.required} hint="still open" />
          <Stat label="Completed" value={stats.completed} />
        </div>
      </header>

      <div className="row-between" style={{ marginBottom: 14 }}>
        <Segmented<Filter>
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'required', label: 'Required' },
            { value: 'completed', label: 'Completed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <span className="xs subtle tnum">{rows.length} shown</span>
      </div>

      {q.isPending ? (
        <TableSkeleton cols={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList size={20} />} title={filter === 'open' ? 'Nothing assigned right now' : 'Nothing matches this filter'} description={filter === 'open' ? 'Your manager or instructor can assign labs with a due date. Until then, follow the recommendations on Home.' : undefined} action={filter === 'open' ? <Link to="/" className="btn btn-secondary btn-md">Back to home</Link> : undefined} />
      ) : (
        <Card className="card-flush">
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Assigned by</th>
                  <th scope="col">Due</th>
                  <th scope="col" style={{ width: 160 }}>
                    Progress
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="sr-only">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="stack" style={{ gap: 3, minWidth: 0 }}>
                        <span className="row" style={{ gap: 8 }}>
                          <ItemLink item={a.item} className="link-strong truncate" />
                          {a.required && <Badge tone="outline">Required</Badge>}
                        </span>
                        <span className="xs subtle truncate">
                          {itemKindLabel[a.item.kind]}
                          {a.item.labIds && a.item.kind !== 'lab' ? ` · ${a.item.labIds.length} labs` : ''} · via {a.via.name ?? a.via.kind}
                          {a.note ? ` · “${a.note}”` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{a.assignedBy.name}</td>
                    <td>
                      <DueDate dueAt={a.dueAt} done={a.status === 'completed'} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <Bar value={a.progress} thin tone={a.status === 'completed' ? 'ok' : 'accent'} />
                        <span className="xs tnum" style={{ width: 32, textAlign: 'right' }}>
                          {pct(a.progress)}
                        </span>
                      </div>
                      {a.bestScore !== undefined && <div className="xs subtle">best {a.bestScore} / 100</div>}
                    </td>
                    <td>
                      <AssignmentStateBadge state={a.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {a.status !== 'completed' && a.item.labIds?.[0] && (
                        <Link to="/labs/$labId/work" params={{ labId: nextLab(a) }} search={{}} className="btn btn-secondary btn-sm">
                          <Play size={12} /> {a.status === 'in_progress' ? 'Continue' : 'Start'}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}

/** The first lab the learner has not finished (the mock does not track per-lab completion inside a path; the first is a fair default). */
function nextLab(a: MyAssignment): string {
  const ids = a.item.labIds ?? [a.item.id];
  const idx = Math.min(ids.length - 1, Math.floor(a.progress * ids.length));
  return ids[idx] ?? ids[0]!;
}
