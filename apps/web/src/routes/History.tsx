import { Link, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Clock, History as HistoryIcon, Lightbulb, XCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useCatalog } from '@/api/client';
import { useAttempt, useMyAttempts } from '@/api/platform';
import type { Attempt, AttemptOutcome } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { SkillTags } from '@/components/domain';
import { OutcomeBadge, When, minutesLabel, outcomeMeta } from '@/components/platform';
import { Card, Drawer, EmptyState, ErrorState, Pager, Select, Skeleton, Stat, TableSkeleton, TableWrap } from '@/components/ui';
import { formatDuration } from '@/lib/utils';
import { usePageCursor } from '@/lib/paging';
import { historyRoute } from '@/router';

const PAGE = 15;
const OUTCOMES: AttemptOutcome[] = ['passed', 'partial', 'failed', 'abandoned', 'in_progress'];

export function History() {
  return (
    <RequireAccess path="/history">
      <HistoryScreen />
    </RequireAccess>
  );
}

function HistoryScreen() {
  const search = historyRoute.useSearch();
  const navigate = useNavigate({ from: historyRoute.fullPath });
  const pages = usePageCursor(JSON.stringify([search.lab, search.outcome]), search.page ?? 1);
  const page = pages.page;
  const q = useMyAttempts({ lab: search.lab, outcome: search.outcome, cursor: pages.cursor, limit: PAGE });
  pages.useRemember(q.data?.nextCursor);
  const all = useMyAttempts({ limit: 200 });
  const catalog = useCatalog();
  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const totals = useMemo(() => {
    const items = all.data?.items ?? [];
    const passed = items.filter((a) => a.outcome === 'passed').length;
    const seconds = items.reduce((s, a) => s + a.durationS, 0);
    const scored = items.filter((a) => a.outcome !== 'abandoned');
    const avg = scored.length ? Math.round(scored.reduce((s, a) => s + a.score, 0) / scored.length) : 0;
    return { attempts: items.length, passed, seconds, avg };
  }, [all.data]);

  const labsSeen = useMemo(() => Array.from(new Map((all.data?.items ?? []).map((a) => [a.labId, a.labTitle])).entries()), [all.data]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Learner</div>
          <h1>History</h1>
          <p className="muted">Every lab attempt with its score, time on task and the checks that produced skill evidence.</p>
        </div>
        <div className="row" style={{ gap: 28 }}>
          <Stat label="Attempts" value={totals.attempts} />
          <Stat label="Passed" value={totals.passed} hint={totals.attempts ? `${Math.round((totals.passed / totals.attempts) * 100)}%` : undefined} />
          <Stat label="Hands-on" value={minutesLabel(totals.seconds)} />
          <Stat label="Avg score" value={totals.avg} />
        </div>
      </header>

      <div className="toolbar">
        <div className="row" style={{ gap: 8 }}>
          <Select aria-label="Lab" value={search.lab ?? ''} onChange={(e) => set({ lab: e.target.value || undefined, page: undefined })}>
            <option value="">All labs</option>
            {labsSeen.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </Select>
          <Select aria-label="Outcome" value={search.outcome ?? ''} onChange={(e) => set({ outcome: e.target.value || undefined, page: undefined })}>
            <option value="">All outcomes</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {outcomeMeta[o].label}
              </option>
            ))}
          </Select>
        </div>
        {q.data && <Pager offset={(page - 1) * PAGE} pageSize={PAGE} total={q.data.total} hasNext={!!q.data.nextCursor} loading={q.isFetching} onChange={(o) => set({ page: o / PAGE + 1 || undefined })} />}
      </div>

      {q.isPending ? (
        <TableSkeleton cols={7} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={<HistoryIcon size={20} />} title={search.lab || search.outcome ? 'No attempts match' : 'No attempts yet'} description={search.lab || search.outcome ? 'Clear the filters to see everything.' : 'Start a lab from the catalog; every attempt lands here with its score and evidence.'} action={!search.lab && !search.outcome ? <Link to="/catalog" search={{}} className="btn btn-secondary btn-md">Open catalog</Link> : undefined} />
      ) : (
        <Card className="card-flush">
          <TableWrap>
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th scope="col">Lab</th>
                  <th scope="col">When</th>
                  <th scope="col">Outcome</th>
                  <th scope="col" className="tnum">
                    Score
                  </th>
                  <th scope="col">Checks</th>
                  <th scope="col">Time</th>
                  <th scope="col">Hints</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((a) => (
                  <tr key={a.id} className="row-link" onClick={() => set({ attempt: a.id })} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), set({ attempt: a.id }))} aria-label={`Open attempt of ${a.labTitle}`}>
                    <td>
                      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                        <span className="small truncate" style={{ fontWeight: 500 }}>
                          {a.labTitle}
                        </span>
                        <span className="xs subtle">{catalog.data?.labs.find((l) => l.id === a.labId)?.domain ?? a.labId}</span>
                      </div>
                    </td>
                    <td className="small">
                      <When iso={a.startedAt} />
                    </td>
                    <td>
                      <OutcomeBadge outcome={a.outcome} />
                    </td>
                    <td className="tnum small">{a.outcome === 'abandoned' ? '—' : a.score}</td>
                    <td className="small tnum">
                      {a.checksPassed}/{a.checksTotal}
                    </td>
                    <td className="small tnum">{formatDuration(a.durationS)}</td>
                    <td className="small tnum">{a.hintsUsed || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <AttemptDrawer id={search.attempt} onClose={() => set({ attempt: undefined })} fallback={q.data?.items.find((a) => a.id === search.attempt)} />
    </div>
  );
}

function AttemptDrawer({ id, onClose, fallback }: { id: string | undefined; onClose: () => void; fallback?: Attempt }) {
  const q = useAttempt(id);
  const a = q.data ?? fallback;
  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={a?.labTitle ?? 'Attempt'} description={a ? `${outcomeMeta[a.outcome].label} · started ${new Date(a.startedAt).toLocaleString()}` : undefined} width={520}>
      {!a ? (
        <Skeleton h={120} />
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          <div className="grid-3">
            <Stat label="Score" value={a.outcome === 'abandoned' ? '—' : a.score} hint="of 100" />
            <Stat label="Checks" value={`${a.checksPassed}/${a.checksTotal}`} />
            <Stat label="Time on task" value={formatDuration(a.durationS)} hint={`${a.validations} validate${a.validations === 1 ? '' : 's'} · ${a.hintsUsed} hint${a.hintsUsed === 1 ? '' : 's'}`} />
          </div>
          <div>
            <div className="task-h">Checks</div>
            {q.isPending ? (
              <Skeleton h={80} />
            ) : q.isError ? (
              <ErrorState error={q.error} onRetry={() => void q.refetch()} />
            ) : (
              <ul className="checks">
                {q.data.checks.map((c) => (
                  <li key={c.checkId} className={`check ${c.passed ? 'check-pass' : 'check-fail'}`}>
                    <div className="check-head" style={{ cursor: 'default' }}>
                      <span className="check-icon">{c.passed ? <CheckCircle2 size={11} /> : <XCircle size={11} />}</span>
                      <span className="check-desc grow">{c.message ?? c.checkId}</span>
                      <span className="xs subtle tnum">weight {c.weight}</span>
                    </div>
                    {c.skills.length > 0 && (
                      <div className="check-detail">
                        <span className="xs subtle">Evidence for</span>
                        <SkillTags ids={c.skills} max={4} size="xs" />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="row xs subtle" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 4 }}>
              <Clock size={11} /> ended <When iso={a.endedAt ?? undefined} />
            </span>
            <span className="row" style={{ gap: 4 }}>
              <Lightbulb size={11} /> {a.hintsUsed} hints
            </span>
            <span className="mono">{a.sessionName}</span>
          </div>
          <Link to="/labs/$labId" params={{ labId: a.labId }} className="btn btn-secondary btn-md" style={{ alignSelf: 'flex-start' }}>
            Open lab
          </Link>
        </div>
      )}
    </Drawer>
  );
}
