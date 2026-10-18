import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Download, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useCreateTeam, useDeleteEvent, useEventReport, useSetTeamMembers, useUpdateEvent } from '@/api/events';
import { downloadCsv } from '@/api/platform';
import type { CtfEventReport, CtfTeam } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { EventForm } from '@/components/events/EventForm';
import { EventStatusBadge, eventWindow } from '@/components/events/ui';
import { UserCell, When } from '@/components/platform';
import { Button, Card, Checkbox, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Input, PageSkeleton, TableWrap } from '@/components/ui';
import { eventManageRoute } from '@/router';
import { ScoreboardView } from './EventScoreboard';

export function EventManage() {
  return (
    <RequireAccess path="/events/manage">
      <ManageScreen />
    </RequireAccess>
  );
}

function ManageScreen() {
  const { eventId } = eventManageRoute.useParams();
  const q = useEventReport(eventId);
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
  return <Manage r={q.data} />;
}

function Manage({ r }: { r: CtfEventReport }) {
  const e = r.event;
  const { toast } = useShell();
  const navigate = useNavigate();
  const update = useUpdateEvent(e.id);
  const remove = useDeleteEvent();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(`/api/events/${e.id}/results.csv`, `ctf-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-results.csv`);
      toast({ title: 'Results exported', tone: 'ok' });
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : undefined, tone: 'warn' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page page-wide">
      <Link to="/events/$eventId" params={{ eventId: e.id }} className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
        <ChevronLeft size={13} /> Event
      </Link>
      <header className="page-header">
        <div>
          <div className="page-eyebrow row" style={{ gap: 8 }}>
            Manage event <EventStatusBadge status={e.status} />
          </div>
          <h1>{e.title}</h1>
          <p className="muted">
            {eventWindow(e.startsAt, e.endsAt)} · {e.mode === 'team' ? `teams of up to ${e.teamSizeMax}` : 'solo'} · {e.scoring} scoring{e.freezeMinutes ? ` · frozen for learners in the last ${e.freezeMinutes} min` : ''}. You see the scoreboard live.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button variant={e.published ? 'ghost' : 'primary'} loading={update.isPending} onClick={() => update.mutate({ published: !e.published }, { onSuccess: (x) => toast({ title: x.published ? 'Published' : 'Unpublished', tone: 'ok' }) })}>
            {e.published ? 'Unpublish' : 'Publish'}
          </Button>
          <Button icon={<Pencil size={13} />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button icon={<Download size={13} />} loading={exporting} onClick={() => void exportCsv()}>
            Export results
          </Button>
          <Button variant="ghost" icon={<Trash2 size={13} />} aria-label="Delete event" onClick={() => setDeleting(true)} />
        </div>
      </header>

      <ScoreboardView board={r.scoreboard} heading={false} />

      {e.mode === 'team' && <TeamsSection r={r} />}

      <section style={{ marginTop: 24 }} aria-labelledby="participants-h">
        <h2 className="task-h" id="participants-h">
          Participants ({r.participants.length})
        </h2>
        {r.participants.length === 0 ? (
          <EmptyState compact icon={<Users size={18} />} title="Nobody has joined yet" />
        ) : (
          <Card className="card-flush">
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    {e.mode === 'team' && <th scope="col">Team</th>}
                    <th scope="col">Joined</th>
                    <th scope="col" className="tnum">
                      Answers
                    </th>
                    <th scope="col" className="tnum">
                      Correct
                    </th>
                    <th scope="col" className="tnum">
                      Hints
                    </th>
                    <th scope="col">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {r.participants.map((p) => (
                    <tr key={p.user.id}>
                      <td>
                        <UserCell user={p.user} size="sm" />
                      </td>
                      {e.mode === 'team' && <td className="small">{p.teamName ?? <span className="subtle">no team</span>}</td>}
                      <td className="small">
                        <When iso={p.joinedAt} />
                      </td>
                      <td className="tnum small">{p.submissions}</td>
                      <td className="tnum small">{p.correct}</td>
                      <td className="tnum small">{p.hints}</td>
                      <td className="small">{p.lastActivityAt ? <When iso={p.lastActivityAt} /> : <span className="subtle">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}
      </section>

      <Drawer open={editing} onOpenChange={setEditing} title="Edit event" width={620}>
        <EventForm
          initial={e}
          submitLabel="Save"
          busy={update.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await update.mutateAsync(v);
            setEditing(false);
            toast({ title: 'Event saved', tone: 'ok' });
          }}
        />
      </Drawer>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        danger
        title={`Delete ${e.title}?`}
        description="Teams and participation are deleted; submitted answers stay in the learners' history."
        confirmLabel="Delete event"
        loading={remove.isPending}
        onConfirm={() => remove.mutate(e.id, { onSuccess: () => void navigate({ to: '/events' }) })}
      />
    </div>
  );
}

function TeamsSection({ r }: { r: CtfEventReport }) {
  const e = r.event;
  const create = useCreateTeam(e.id);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [edit, setEdit] = useState<CtfTeam | null>(null);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) return setError('Give the team a name.');
    create.mutate(name.trim(), { onSuccess: () => (setName(''), setError(undefined)), onError: (err) => setError(err.message) });
  };
  return (
    <section style={{ marginTop: 24 }} aria-labelledby="teams-h">
      <div className="row-between" style={{ marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <h2 className="task-h" id="teams-h" style={{ margin: 0 }}>
          Teams ({e.teamList.length})
        </h2>
        <form className="row" style={{ gap: 8, alignItems: 'flex-end' }} onSubmit={submit}>
          <Field label="New team" error={error} inline>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={name} maxLength={60} onChange={(x) => setName(x.target.value)} placeholder="Team name" />}
          </Field>
          <Button type="submit" size="sm" icon={<Plus size={13} />} loading={create.isPending}>
            Add team
          </Button>
        </form>
      </div>
      {e.teamList.length === 0 ? (
        <EmptyState compact icon={<Users size={18} />} title="No teams yet" description={e.teamFormation === 'self' ? 'Learners create teams when they join, or add some here.' : 'Add teams, then put participants in them.'} />
      ) : (
        <ul className="team-list">
          {e.teamList.map((t) => (
            <li key={t.id} className="team-item">
              <Users size={15} aria-hidden />
              <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="small" style={{ fontWeight: 500 }}>
                  {t.name}
                </span>
                <span className="xs subtle truncate">
                  {t.members.length}/{e.teamSizeMax} · {t.members.map((m) => m.name).join(', ') || 'no members'}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEdit(t)} aria-label={`Edit members of ${t.name}`}>
                Members
              </Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <MembersDrawer r={r} team={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function MembersDrawer({ r, team, onClose }: { r: CtfEventReport; team: CtfTeam; onClose: () => void }) {
  const e = r.event;
  const save = useSetTeamMembers(e.id);
  const { toast } = useShell();
  const [ids, setIds] = useState<string[]>(team.members.map((m) => m.id));
  const candidates = r.participants.filter((p) => !p.teamId || p.teamId === team.id);
  const max = e.teamSizeMax ?? 1;
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Members of ${team.name}`}
      description={`Participants without a team, at most ${max}.`}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={ids.length > max}
            onClick={() =>
              save.mutate(
                { teamId: team.id, userIds: ids },
                { onSuccess: () => (toast({ title: 'Team updated', tone: 'ok' }), onClose()), onError: (err) => toast({ title: 'Not saved', description: err.message, tone: 'warn' }) },
              )
            }
          >
            Save members
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="small subtle">Everyone who joined is already in a team.</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {candidates.map((p) => (
            <Checkbox key={p.user.id} label={p.user.name} description={p.user.email} checked={ids.includes(p.user.id)} onChange={(x) => setIds((cur) => (x.target.checked ? [...cur, p.user.id] : cur.filter((i) => i !== p.user.id)))} />
          ))}
          {ids.length > max && (
            <p className="small text-err" role="alert">
              Teams have at most {max} members.
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
