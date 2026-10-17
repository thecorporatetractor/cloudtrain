import { Pin, PinOff } from 'lucide-react';
import { useContentVisibility, useUpdateContent } from '@/api/platform';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { DomainIcon, domainLabel } from '@/components/domain';
import { Badge, Button, Card, ErrorState, PageSkeleton, Switch } from '@/components/ui';
import { cn } from '@/lib/utils';

export function AdminContent() {
  return (
    <RequireAccess path="/admin/content">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const q = useContentVisibility();
  const update = useUpdateContent();
  const { toast } = useShell();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const fail = (e: Error) => toast({ title: 'Could not save', description: e.message, tone: 'err' });

  return (
    <div className="split split-7-5" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ gap: 16 }}>
        <p className="muted small">Disabled packs and labs disappear from the catalog and Home for this organisation and cannot be started. Assignments that point at them stay but cannot be completed, so check the team assignments first.</p>
        {d.packs.map((p) => (
          <Card key={p.packId} className={cn('card-flush', !p.enabled && 'card-muted')}>
            <div className="card-head">
              <h2 className="row" style={{ gap: 8 }}>
                <DomainIcon domain={p.domain} size={14} className="subtle" /> {p.title}
                <span className="subtle small">
                  · {domainLabel[p.domain]} · {p.labs.length} labs
                </span>
              </h2>
              <span className="row" style={{ gap: 10 }}>
                <span className="xs subtle">{p.enabled ? 'Enabled' : 'Disabled for this org'}</span>
                <Switch label={`Enable ${p.title}`} checked={p.enabled} disabled={update.isPending} onCheckedChange={(v) => update.mutate({ packs: [{ packId: p.packId, enabled: v }] }, { onSuccess: () => toast({ title: `${p.title} ${v ? 'enabled' : 'disabled'}`, tone: v ? 'ok' : 'warn' }), onError: fail })} />
              </span>
            </div>
            <ul className="due-list">
              {p.labs.map((l) => (
                <li key={l.labId} className="due-row" style={{ opacity: p.enabled ? 1 : 0.55 }}>
                  <span className="small grow truncate">{l.title}</span>
                  {!l.enabled && <Badge tone="warn">hidden</Badge>}
                  <Switch label={`Enable ${l.title}`} checked={l.enabled} disabled={!p.enabled || update.isPending} onCheckedChange={(v) => update.mutate({ labs: [{ labId: l.labId, enabled: v }] }, { onSuccess: () => toast({ title: `${l.title} ${v ? 'enabled' : 'hidden'}`, tone: 'neutral' }), onError: fail })} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="card-flush" style={{ position: 'sticky', top: 24 }}>
        <div className="card-head">
          <h2>Pinned paths</h2>
          <span className="xs subtle">shown first in the catalog and on Home</span>
        </div>
        <ul className="due-list">
          {d.paths.map((p) => {
            const pinned = d.pinnedPaths.includes(p.id);
            return (
              <li key={p.id} className="due-row">
                <span className="small grow truncate">{p.title}</span>
                {pinned && <Badge tone="accent">pinned</Badge>}
                <Button variant="ghost" size="sm" icon={pinned ? <PinOff size={13} /> : <Pin size={13} />} disabled={update.isPending} onClick={() => update.mutate({ pinnedPaths: pinned ? d.pinnedPaths.filter((x) => x !== p.id) : [...d.pinnedPaths, p.id] }, { onError: fail })}>
                  {pinned ? 'Unpin' : 'Pin'}
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
