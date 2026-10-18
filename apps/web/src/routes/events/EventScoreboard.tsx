import { Link } from '@tanstack/react-router';
import { ChevronLeft, Droplet } from 'lucide-react';
import { useScoreboard } from '@/api/events';
import type { CtfScoreboard } from '@/api/types';
import { EventCountdown, EventStatusBadge, FrozenNote, ScoreTable, SolveTimeline, SolvesFeed, useServerClock } from '@/components/events/ui';
import { Card, ErrorState, PageSkeleton } from '@/components/ui';
import { eventScoreboardRoute } from '@/router';

export function EventScoreboard() {
  const { eventId } = eventScoreboardRoute.useParams();
  const q = useScoreboard(eventId);
  if (q.isPending)
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  if (q.isError)
    return (
      <div className="page">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  return (
    <div className="page page-wide">
      <Link to="/events/$eventId" params={{ eventId }} className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
        <ChevronLeft size={13} /> Event
      </Link>
      <ScoreboardView board={q.data} />
    </div>
  );
}

/** The scoreboard: ranks, the solve timeline, recent solves and per-question stats. Live updates every 10 s while running. */
export function ScoreboardView({ board, heading = true }: { board: CtfScoreboard; heading?: boolean }) {
  const now = useServerClock(board.serverNow);
  return (
    <>
      {heading && (
        <header className="page-header">
          <div>
            <div className="page-eyebrow row" style={{ gap: 8 }}>
              Scoreboard <EventStatusBadge status={board.status} />
            </div>
            <h1>{board.title}</h1>
            <p className="muted">
              {board.mode === 'team' ? 'Teams' : 'Players'} ranked by points; equal points go to whoever reached them first. {board.scoring === 'dynamic' ? 'Question values drop as more entrants solve them.' : ''}
            </p>
          </div>
          <EventCountdown startsAt={board.startsAt} endsAt={board.endsAt} now={now} />
        </header>
      )}
      <FrozenNote board={board} />
      <div className="event-layout">
        <div className="stack" style={{ gap: 20, minWidth: 0 }}>
          <Card className="card-flush">
            <ScoreTable board={board} />
          </Card>
          <Card>
            <h2 className="task-h">Solve timeline</h2>
            <SolveTimeline board={board} now={now} />
          </Card>
        </div>
        <div className="stack" style={{ gap: 20, minWidth: 0 }}>
          <Card>
            <h2 className="task-h">Recent solves</h2>
            <SolvesFeed solves={board.solves} />
          </Card>
          <Card className="card-flush">
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Questions: value now, solves and first blood</caption>
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    <th scope="col" className="tnum">
                      Value
                    </th>
                    <th scope="col" className="tnum">
                      Solves
                    </th>
                    <th scope="col">First blood</th>
                  </tr>
                </thead>
                <tbody>
                  {board.questions.map((q) => (
                    <tr key={`${q.labId}/${q.checkId}`}>
                      <td className="small">
                        <span className="subtle tnum">Q{q.questionNumber}</span> <span className="xs subtle">{q.labId}</span>
                      </td>
                      <td className="tnum small">
                        {q.value}
                        {q.value < q.points && <span className="subtle">/{q.points}</span>}
                      </td>
                      <td className="tnum small">{q.solves}</td>
                      <td className="small">
                        {q.firstBlood ? (
                          <span className="first-blood">
                            <Droplet size={11} aria-hidden /> {q.firstBlood.entrantName}
                          </span>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
