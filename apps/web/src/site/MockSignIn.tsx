import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { UserRound } from 'lucide-react';
import { request, useMe } from '@/api/client';
import { isRealApi } from '@/api/mode';
import { useSetPersona } from '@/api/platform';

interface Persona {
  id: string;
  label: string;
  hint: string;
}

/**
 * Mock mode only (never rendered in real mode): a first visit is signed out so the
 * public website shows; these chips sign in as one of the sample personas and open
 * the dashboard. The persona switcher in the app's navigation does the same later.
 */
export function MockSignIn() {
  const me = useMe();
  const personas = useQuery({ queryKey: ['dev', 'personas'], queryFn: () => request<Persona[]>('/api/dev/personas'), staleTime: Infinity, enabled: !isRealApi });
  const set = useSetPersona();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (isRealApi || me.isSuccess || !personas.data?.length) return null;
  return (
    <div className="site-mock" role="note" aria-label="Mock mode">
      <span className="xs subtle row" style={{ gap: 6 }}>
        <UserRound size={12} aria-hidden /> Mock mode: sign in as a sample persona
      </span>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {personas.data.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip"
            title={p.hint}
            disabled={set.isPending}
            onClick={() =>
              set.mutate(p.id, {
                onSuccess: async () => {
                  await qc.invalidateQueries({ queryKey: ['me'] });
                  void navigate({ to: '/' });
                },
              })
            }
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
