import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Clock, Play, Settings2, Trophy, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/api/client';
import { useEvent, useJoinEvent, useLeaveEvent, useScoreboard, useStartEventLab } from '@/api/events';
import type { CtfEventDetail } from '@/api/types';
import { useShell } from '@/app/shell-context';
import { DifficultyBadge } from '@/components/domain';
import { EventCountdown, EventStatusBadge, ScoreTable, eventWindow, useServerClock } from '@/components/events/ui';
import { Prose } from '@/components/prose';
import { Badge, Button, Card, ErrorState, Field, Input, PageSkeleton, Stat } from '@/components/ui';
import { cn, formatMinutes } from '@/lib/utils';
import { eventRoute } from '@/router';

export function EventDetail() {
  const { eventId } = eventRoute.useParams();
  const q = useEvent(eventId);
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
  return <EventScreen e={q.data} />;
}

function EventScreen({ e }: { e: CtfEventDetail }) {
  const now = useServerClock(e.serverNow);
  const navigate = useNavigate();
  const { toast } = useShell();
  const start = useStartEventLab(e.id);
  const leave = useLeaveEvent(e.id);
  const board = useScoreboard(e.id);
  const running = e.status === 'running' && now < Date.parse(e.endsAt);
  const canPlay = running && e.joined && (e.mode === 'solo' || !!e.myTeam);

  const play = (labId: string) => {
    const resume = e.mySessions[labId];
    if (resume) return void navigate({ to: '/labs/$labId/work', params: { labId }, search: { s: resume } });
    start.mutate(labId, {
      onSuccess: (s) => void navigate({ to: '/labs/$labId/work', params: { labId }, search: { s: s.id } }),
      onError: (err) => toast({ title: 'The lab could not start', description: err.message, tone: 'warn' }),
    });
  };

  return (
    <div className="page page-wide">
      <Link to="/events" className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
        <ChevronLeft size={13} /> Events
      </Link>
      <header className="page-header">
        <div>
          <div className="page-eyebrow row" style={{ gap: 8 }}>
            CTF event <EventStatusBadge status={e.status} />
          </div>
          <h1>{e.title}</h1>
          <p className="muted row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="row" style={{ gap: 4 }}>
              <Clock size={13} aria-hidden /> {eventWindow(e.startsAt, e.endsAt)}
            </span>
            {e.status !== 'draft' && <EventCountdown startsAt={e.startsAt} endsAt={e.endsAt} now={now} />}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {e.status !== 'draft' && (
            <Link to="/events/$eventId/scoreboard" params={{ eventId: e.id }} className="btn btn-secondary btn-md">
              <Trophy size={14} aria-hidden /> Scoreboard
            </Link>
          )}
          {e.canManage && (
            <Link to="/events/$eventId/manage" params={{ eventId: e.id }} className="btn btn-ghost btn-md">
              <Settings2 size={14} aria-hidden /> Manage
            </Link>
          )}
        </div>
      </header>

      <div className="event-layout">
        <div className="stack" style={{ gap: 20, minWidth: 0 }}>
          {e.description && (
            <Card>
              <Prose text={e.description} className="small" />
            </Card>
          )}
          <div className="grid-3">
            <Stat label="Format" value={e.mode === 'team' ? 'Teams' : 'Solo'} hint={e.mode === 'team' ? `up to ${e.teamSizeMax} per team` : 'every player for themselves'} />
            <Stat label="Scoring" value={e.scoring === 'dynamic' ? 'Dynamic' : 'Static'} hint={e.scoring === 'dynamic' ? `values drop to ${e.dynamicMinPct}% after ${e.dynamicDecay} solves` : 'each question worth its points'} />
            <Stat label="Entrants" value={e.mode === 'team' ? e.teams : e.participants} hint={e.mode === 'team' ? `${e.participants} people` : undefined} />
          </div>
          <section aria-labelledby="labs-h">
            <h2 className="task-h" id="labs-h">
              Challenges
            </h2>
            <ul className="event-labs">
              {e.labs.map((l) => (
                <li key={l.labId} className="event-lab">
                  <div className="stack grow" style={{ gap: 3, minWidth: 0 }}>
                    <span className="small truncate" style={{ fontWeight: 500 }}>
                      {l.title}
                    </span>
                    <span className="row xs subtle" style={{ gap: 10 }}>
                      <DifficultyBadge difficulty={l.difficulty} />
                      <span>{l.questionCount} questions</span>
                      <span>{l.points} pts</span>
                      <span>~{formatMinutes(l.estimatedMinutes)}</span>
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={canPlay ? 'primary' : 'secondary'}
                    icon={<Play size={12} />}
                    disabled={!canPlay}
                    loading={start.isPending && start.variables === l.labId}
                    onClick={() => play(l.labId)}
                    title={!running ? 'Opens when the event starts' : !e.joined ? 'Join the event first' : e.mode === 'team' && !e.myTeam ? 'Join a team first' : undefined}
                  >
                    {e.mySessions[l.labId] ? 'Resume' : 'Start'}
                  </Button>
                </li>
              ))}
            </ul>
            {e.mode === 'team' && <p className="xs subtle" style={{ marginTop: 8 }}>Teammates work on the same data: a question one of you solves is solved for the whole team.</p>}
          </section>
        </div>

        <div className="stack" style={{ gap: 20, minWidth: 0 }}>
          <JoinPanel e={e} />
          {e.joined && (e.status === 'upcoming' || e.status === 'draft') && (
            <Button variant="ghost" size="sm" loading={leave.isPending} onClick={() => leave.mutate()}>
              Leave the event
            </Button>
          )}
          {board.data && e.status !== 'draft' && (
            <Card className="card-flush">
              <div className="row-between" style={{ padding: '12px 14px 0' }}>
                <h2 className="task-h" style={{ margin: 0 }}>
                  Top {Math.min(5, board.data.rows.length)}
                </h2>
                <Link to="/events/$eventId/scoreboard" params={{ eventId: e.id }} className="xs link-quiet">
                  Full scoreboard
                </Link>
              </div>
              <ScoreTable board={{ ...board.data, rows: board.data.rows.slice(0, 5) }} compact />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function JoinPanel({ e }: { e: CtfEventDetail }) {
  const join = useJoinEvent(e.id);
  const { toast } = useShell();
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string>();
  const closed = e.status === 'ended' || e.status === 'draft';
  const doJoin = (body: { teamId?: string; teamName?: string } = {}) =>
    join.mutate(body, {
      onSuccess: () => {
        setError(undefined);
        toast({ title: 'You joined the event', tone: 'ok' });
      },
      onError: (err) => setError(err instanceof ApiError && err.details?.teamName ? String(err.details.teamName) : err.message),
    });
  const create = (ev: FormEvent) => {
    ev.preventDefault();
    if (!teamName.trim()) return setError('Give your team a name.');
    doJoin({ teamName: teamName.trim() });
  };

  if (e.mode === 'solo' || e.teamFormation === 'manager') {
    return (
      <Card className="stack" style={{ gap: 10 }}>
        <h2 className="task-h" style={{ margin: 0 }}>
          {e.joined ? 'You are in' : 'Join'}
        </h2>
        {e.joined ? (
          e.mode === 'team' ? (
            e.myTeam ? (
              <TeamCard team={e.myTeam} mine />
            ) : (
              <p className="small subtle">Your manager puts you in a team before the start.</p>
            )
          ) : (
            <p className="small">You play solo: your points are yours alone.</p>
          )
        ) : (
          <Button variant="primary" disabled={closed} loading={join.isPending} onClick={() => doJoin()}>
            Join the event
          </Button>
        )}
        {error && (
          <p className="small text-err" role="alert">
            {error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="stack" style={{ gap: 12 }}>
      <h2 className="task-h" style={{ margin: 0 }}>
        {e.myTeam ? 'Your team' : 'Join a team'}
      </h2>
      {e.myTeam ? (
        <TeamCard team={e.myTeam} mine />
      ) : (
        <>
          <form onSubmit={create} className="stack" style={{ gap: 8 }}>
            <Field label="Start a team" error={error}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={teamName} maxLength={60} onChange={(ev) => setTeamName(ev.target.value)} placeholder="Team name" disabled={closed} />}
            </Field>
            <Button type="submit" variant="primary" size="sm" loading={join.isPending && !!join.variables?.teamName} disabled={closed}>
              Create and join
            </Button>
          </form>
          {e.teamList.length > 0 && (
            <ul className="team-list" aria-label="Teams">
              {e.teamList.map((t) => {
                const full = t.members.length >= (e.teamSizeMax ?? 1);
                return (
                  <li key={t.id} className="team-item">
                    <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                      <span className="small truncate">{t.name}</span>
                      <span className="xs subtle truncate">
                        {t.members.length}/{e.teamSizeMax} · {t.members.map((m) => m.name).join(', ')}
                      </span>
                    </div>
                    <Button size="sm" variant="secondary" disabled={full || closed} loading={join.isPending && join.variables?.teamId === t.id} onClick={() => doJoin({ teamId: t.id })} aria-label={`Join ${t.name}`}>
                      {full ? 'Full' : 'Join'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function TeamCard({ team, mine }: { team: CtfEventDetail['teamList'][number]; mine?: boolean }) {
  return (
    <div className={cn('team-item', mine && 'is-mine')}>
      <Users size={15} aria-hidden />
      <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
        <span className="small" style={{ fontWeight: 500 }}>
          {team.name}
        </span>
        <span className="xs subtle">{team.members.map((m) => m.name).join(', ')}</span>
      </div>
      {mine && <Badge tone="accent">you</Badge>}
    </div>
  );
}
