import { Package } from 'lucide-react';
import { usePlatformContent } from '@/api/platform';
import { RequireAccess } from '@/app/access';
import { DomainIcon, domainLabel } from '@/components/domain';
import { When } from '@/components/platform';
import { Badge, Card, EmptyState, ErrorState, TableSkeleton, TableWrap } from '@/components/ui';

export function PlatformContent() {
  return (
    <RequireAccess path="/platform">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const q = usePlatformContent();
  if (q.isPending) return <TableSkeleton cols={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) return <EmptyState icon={<Package size={20} />} title="No content packs" />;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="muted small">Global packs ship with CloudTrain and are available to every organisation; org admins can hide packs or labs for their org. Org-specific packs come from Scenario Studio and stay inside that organisation.</p>
      <Card className="card-flush">
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Pack</th>
                <th scope="col">Domain</th>
                <th scope="col">Version</th>
                <th scope="col">Labs</th>
                <th scope="col">Enabled in</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="small" style={{ fontWeight: 500 }}>
                        {p.title}
                      </span>
                      <Badge tone={p.global ? 'accent' : 'outline'}>{p.global ? 'global' : 'org'}</Badge>
                    </span>
                    <div className="xs subtle mono">{p.id}</div>
                  </td>
                  <td className="small">
                    <span className="row" style={{ gap: 6 }}>
                      <DomainIcon domain={p.domain} size={12} /> {domainLabel[p.domain]}
                    </span>
                  </td>
                  <td className="small mono">{p.version}</td>
                  <td className="small tnum">{p.labs}</td>
                  <td className="small tnum">{p.orgsEnabled} orgs</td>
                  <td className="small">
                    <When iso={p.updatedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
