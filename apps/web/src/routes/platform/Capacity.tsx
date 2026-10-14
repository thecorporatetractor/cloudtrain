import { AlertTriangle, Cpu, RefreshCw, Server } from 'lucide-react';
import { useCapacity } from '@/api/platform';
import { RequireAccess } from '@/app/access';
import { Bar } from '@/components/charts';
import { Badge, Button, Card, Dot, ErrorState, Meter, PageSkeleton, Stat, TableWrap } from '@/components/ui';
import { cn, pct, relativeTime } from '@/lib/utils';

export function PlatformCapacity() {
  return (
    <RequireAccess path="/platform/capacity">
      <Screen />
    </RequireAccess>
  );
}

const gib = (mib: number) => `${(mib / 1024).toFixed(0)} GiB`;

function Screen() {
  const q = useCapacity();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const cpu = c.nodes.reduce((s, n) => ({ req: s.req + n.cpu.requested, alloc: s.alloc + (n.ready ? n.cpu.allocatable : 0) }), { req: 0, alloc: 0 });
  const mem = c.nodes.reduce((s, n) => ({ req: s.req + n.memoryMiB.requested, alloc: s.alloc + (n.ready ? n.memoryMiB.allocatable : 0) }), { req: 0, alloc: 0 });
  const notReady = c.nodes.filter((n) => !n.ready);
  const poolsShort = c.warmPools.filter((p) => p.ready < p.size);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <div className="row" style={{ gap: 10 }}>
          <Dot tone={c.cluster.reachable ? 'ok' : 'err'} />
          <span className="small">
            <span className="mono">{c.cluster.context}</span> · {c.cluster.reachable ? 'reachable' : (c.cluster.error ?? 'unreachable')} · updated {relativeTime(c.generatedAt)}
          </span>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={13} className={cn(q.isFetching && 'spin')} />} onClick={() => void q.refetch()}>
          Refresh
        </Button>
      </div>

      {(notReady.length > 0 || poolsShort.length > 0) && (
        <div className="callout row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={14} className="text-warn" style={{ marginTop: 2 }} />
          <span className="small">
            {notReady.length > 0 && <>{notReady.map((n) => n.name).join(', ')} not ready; its VMs are being rescheduled. </>}
            {poolsShort.length > 0 && <>Warm pools below target: {poolsShort.map((p) => `${p.name} ${p.ready}/${p.size}`).join(', ')}. New sessions on those templates take longer to start.</>}
          </span>
        </div>
      )}

      <div className="stat-row">
        <Stat label="Nodes" value={`${c.nodes.filter((n) => n.ready).length}/${c.nodes.length}`} hint="ready" tone={notReady.length ? 'warn' : undefined} />
        <Stat label="Running VMs" value={c.vms.running} hint={`${c.vms.total} total`} />
        <Stat label="Lab sessions" value={c.sessions.total} hint={Object.entries(c.sessions.byPhase).map(([k, v]) => `${v} ${k}`).join(' · ')} />
        <Stat label="CPU requested" value={pct(cpu.alloc ? cpu.req / cpu.alloc : 0)} hint={`${cpu.req.toFixed(1)} of ${cpu.alloc} cores`} tone={cpu.req / Math.max(1, cpu.alloc) > 0.85 ? 'warn' : undefined} />
        <Stat label="Memory requested" value={pct(mem.alloc ? mem.req / mem.alloc : 0)} hint={`${gib(mem.req)} of ${gib(mem.alloc)}`} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 5fr)', gap: 20, alignItems: 'start' }}>
        <Card className="card-flush">
          <div className="card-head">
            <h2 className="row" style={{ gap: 8 }}>
              <Server size={14} className="subtle" /> Cluster nodes
            </h2>
          </div>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Node</th>
                  <th scope="col">Roles</th>
                  <th scope="col" style={{ width: 160 }}>
                    CPU
                  </th>
                  <th scope="col" style={{ width: 160 }}>
                    Memory
                  </th>
                  <th scope="col">Pods</th>
                  <th scope="col">VMs</th>
                </tr>
              </thead>
              <tbody>
                {c.nodes.map((n) => (
                  <tr key={n.name}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Dot tone={n.ready ? 'ok' : 'err'} />
                        <span className="small mono">{n.name}</span>
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 4 }}>
                        {n.roles.map((r) => (
                          <Badge key={r} tone={r === 'kvm' ? 'accent' : 'outline'}>
                            {r}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td>
                      <Usage used={n.cpu.requested} total={n.cpu.allocatable} label={`${n.cpu.requested.toFixed(1)} / ${n.cpu.allocatable}`} />
                    </td>
                    <td>
                      <Usage used={n.memoryMiB.requested} total={n.memoryMiB.allocatable} label={`${gib(n.memoryMiB.requested)} / ${gib(n.memoryMiB.allocatable)}`} />
                    </td>
                    <td className="small tnum">{n.pods}</td>
                    <td className="small tnum">{n.vms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2 className="row" style={{ gap: 8 }}>
                <Cpu size={14} className="subtle" /> Warm pools
              </h2>
              <span className="xs subtle">pre-provisioned VMs and clusters</span>
            </div>
            <ul className="due-list">
              {c.warmPools.map((p) => (
                <li key={p.name} className="due-row">
                  <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                    <span className="small mono">{p.name}</span>
                    <span className="xs subtle truncate">
                      {p.template} · {p.namespace}
                    </span>
                  </span>
                  <span style={{ width: 90 }}>
                    <Meter value={p.size ? p.ready / p.size : 0} tone={p.ready < p.size ? 'warn' : 'ok'} label={`${p.name} readiness`} thin />
                  </span>
                  <span className={cn('small tnum', p.ready < p.size && 'text-warn')} style={{ width: 40, textAlign: 'right' }}>
                    {p.ready}/{p.size}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Sessions by organisation</h2>
            </div>
            <ul className="domain-readiness" style={{ padding: '14px 20px 16px' }}>
              {c.sessions.byOrg.map((o) => (
                <li key={o.orgId} className="stack" style={{ gap: 5 }}>
                  <div className="row-between small">
                    <span>{o.name}</span>
                    <span className="tnum">{o.count}</span>
                  </div>
                  <Bar value={c.sessions.total ? o.count / c.sessions.total : 0} thin />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Usage({ used, total, label }: { used: number; total: number; label: string }) {
  const v = total ? used / total : 0;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <Meter value={v} tone={v > 0.85 ? 'warn' : 'accent'} label={label} thin />
      <span className="xs subtle tnum">{label}</span>
    </div>
  );
}
