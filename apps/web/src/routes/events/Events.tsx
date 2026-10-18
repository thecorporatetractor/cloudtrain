import { Link, useNavigate } from '@tanstack/react-router';
import { Flag, Plus, Trophy, Users } from 'lucide-react';
import { useState } from 'react';
import { useCreateEvent, useEvents } from '@/api/events';
import type { CtfEventSummary } from '@/api/types';
import { can } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { useMe } from '@/api/client';
import { EventForm } from '@/components/events/EventForm';
import { EventStatusBadge, eventWindow } from '@/components/events/ui';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, PageSkeleton } from '@/components/ui';

const ORDER: Record<CtfEventSummary['status'], number> = { running: 0, upcoming: 1, draft: 2, ended: 3 };

/** CTF events: live and upcoming first. Managers create events here. */
export function Events() {
  const me = useMe();
  const events = useEvents();
  const create = useCreateEvent();
  const navigate = useNavigate();
  const { toast } = useShell();
  const [creating, setCreating] = useState(false);
  const manage = can(me.data, 'event.manage');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Capture the flag</div>
          <h1>Events</h1>
          <p className="muted">Timed CTF events: investigate seeded incidents, alone or as a team, and climb the scoreboard. Solo CTF labs stay in the catalog.</p>
        </div>
        {manage && (
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New event
          </Button>
        )}
      </header>

      {events.isPending ? (
        <PageSkeleton />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <EmptyState icon={<Flag size={20} />} title="No events yet" description={manage ? 'Create an event from CTF labs; learners see it once you publish it.' : 'Your organisation has not published a CTF event yet.'} />
      ) : (
        <div className="event-grid">
          {[...events.data]
            .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.startsAt.localeCompare(b.startsAt))
            .map((e) => (
              <Card key={e.id} className="event-card">
                <div className="row-between" style={{ gap: 8 }}>
                  <EventStatusBadge status={e.status} />
                  {e.joined && <Badge tone="accent">joined</Badge>}
                </div>
                <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>
                  <Link to="/events/$eventId" params={{ eventId: e.id }} className="link-quiet">
                    {e.title}
                  </Link>
                </h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {eventWindow(e.startsAt, e.endsAt)}
                </p>
                <div className="event-meta xs subtle">
                  <span className="row" style={{ gap: 4 }}>
                    <Users size={12} aria-hidden /> {e.mode === 'team' ? `teams of up to ${e.teamSizeMax}` : 'solo'}
                  </span>
                  <span>{e.labIds.length} lab{e.labIds.length === 1 ? '' : 's'}</span>
                  <span>{e.scoring === 'dynamic' ? 'dynamic points' : 'static points'}</span>
                  <span>
                    {e.participants} joined{e.mode === 'team' ? ` · ${e.teams} teams` : ''}
                  </span>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
                  <Link to="/events/$eventId" params={{ eventId: e.id }} className="btn btn-secondary btn-sm">
                    {e.status === 'running' && e.joined ? 'Play' : 'Open'}
                  </Link>
                  {e.status !== 'draft' && (
                    <Link to="/events/$eventId/scoreboard" params={{ eventId: e.id }} className="btn btn-ghost btn-sm">
                      <Trophy size={13} aria-hidden /> Scoreboard
                    </Link>
                  )}
                </div>
              </Card>
            ))}
        </div>
      )}

      <Drawer open={creating} onOpenChange={setCreating} title="New CTF event" description="Pick CTF labs, the window and how it is scored." width={620}>
        <EventForm
          submitLabel="Create event"
          busy={create.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={async (v) => {
            const e = await create.mutateAsync(v);
            setCreating(false);
            toast({ title: 'Event created', description: e.published ? 'Learners can join it now.' : 'Publish it when you are ready.', tone: 'ok' });
            void navigate({ to: '/events/$eventId/manage', params: { eventId: e.id } });
          }}
        />
      </Drawer>
    </div>
  );
}
