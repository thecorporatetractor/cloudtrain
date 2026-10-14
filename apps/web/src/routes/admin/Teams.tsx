import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, FolderTree, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAddTeamMember, useAdminTeam, useAdminTeams, useAdminUsers, useCreateTeam, useDeleteTeam, useRemoveTeamMember, useUpdateTeam } from '@/api/platform';
import type { Team, TeamRole } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { UserCell } from '@/components/platform';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, PageSkeleton, Select, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { adminTeamsRoute } from '@/router';

export function AdminTeams() {
  return (
    <RequireAccess path="/admin/teams">
      <Screen />
    </RequireAccess>
  );
}

interface TreeNode extends Team {
  children: TreeNode[];
  depth: number;
}
function buildTree(teams: Team[]): TreeNode[] {
  const byParent = new Map<string | null, Team[]>();
  teams.forEach((t) => byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t]));
  const walk = (parent: string | null, depth: number): TreeNode[] => (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ ...t, depth, children: walk(t.id, depth + 1) }));
  return walk(null, 0);
}
const flatten = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

function Screen() {
  const search = adminTeamsRoute.useSearch();
  const navigate = useNavigate({ from: adminTeamsRoute.fullPath });
  const teams = useAdminTeams();
  const tree = useMemo(() => buildTree(teams.data ?? []), [teams.data]);
  const flat = useMemo(() => flatten(tree), [tree]);
  const selected = search.team && flat.some((t) => t.id === search.team) ? search.team : flat[0]?.id;
  useEffect(() => {
    if (selected && search.team !== selected) void navigate({ search: { team: selected }, replace: true });
  }, [selected, search.team, navigate]);
  const [create, setCreate] = useState(false);

  if (teams.isPending) return <PageSkeleton />;
  if (teams.isError) return <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />;

  return (
    <div className="split-layout">
      <Card className="card-flush">
        <div className="card-head">
          <h2 className="row" style={{ gap: 8 }}>
            <FolderTree size={14} className="subtle" /> Teams <span className="subtle small tnum">{flat.length}</span>
          </h2>
          <Button variant="ghost" size="sm" icon={<Plus size={13} />} onClick={() => setCreate(true)}>
            New
          </Button>
        </div>
        {flat.length === 0 ? (
          <EmptyState compact title="No teams yet" description="Create a team, then add members and a manager." />
        ) : (
          <ul className="tree" role="tree" aria-label="Teams">
            {flat.map((t) => (
              <li key={t.id} role="treeitem" aria-selected={t.id === selected} aria-level={t.depth + 1}>
                <button type="button" className={cn('tree-row', t.id === selected && 'is-active')} style={{ paddingLeft: 12 + t.depth * 18 }} onClick={() => void navigate({ search: { team: t.id } })}>
                  {t.depth > 0 && <span className="tree-elbow" aria-hidden />}
                  <span className="small truncate grow">{t.name}</span>
                  <span className="xs subtle tnum">{t.memberCount}</span>
                  <ChevronRight size={12} className="subtle" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {selected ? <TeamPanel id={selected} all={teams.data} /> : <div />}
      <CreateTeamDialog open={create} onOpenChange={setCreate} teams={teams.data} onCreated={(t) => void navigate({ search: { team: t.id } })} />
    </div>
  );
}

function TeamPanel({ id, all }: { id: string; all: Team[] }) {
  const q = useAdminTeam(id);
  const update = useUpdateTeam();
  const remove = useDeleteTeam();
  const addMember = useAddTeamMember(id);
  const removeMember = useRemoveTeamMember(id);
  const users = useAdminUsers({ limit: 200, status: 'active' });
  const { toast } = useShell();
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [newRole, setNewRole] = useState<TeamRole>('member');
  useEffect(() => setName(q.data?.name ?? ''), [q.data?.name]);

  if (q.isPending) return <Skeleton h={320} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data;
  const parent = all.find((x) => x.id === t.parentId);
  const candidates = (users.data?.items ?? []).filter((u) => !t.members.some((m) => m.user.id === u.id));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card>
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div className="stack grow" style={{ gap: 10 }}>
            <div className="page-eyebrow" style={{ marginBottom: 0 }}>
              {parent ? `${parent.name} · sub-team` : 'Top-level team'}
            </div>
            <form
              className="row"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== t.name) update.mutate({ id, name: name.trim() }, { onSuccess: () => toast({ title: 'Team renamed', tone: 'ok' }) });
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Team name" style={{ maxWidth: 320, fontSize: 'var(--text-lg)', fontWeight: 600 }} />
              {name.trim() !== t.name && (
                <Button type="submit" variant="secondary" size="sm" loading={update.isPending}>
                  Rename
                </Button>
              )}
            </form>
            <div className="row xs subtle" style={{ gap: 12 }}>
              <span>{t.members.length} members</span>
              <span>{t.managers.length ? `managed by ${t.managers.map((m) => m.name).join(', ')}` : 'no manager yet'}</span>
              {t.children.length > 0 && <span>{t.children.length} sub-teams</span>}
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)} disabled={t.children.length > 0} title={t.children.length ? 'Move or delete its sub-teams first' : undefined}>
            Delete
          </Button>
        </div>
      </Card>

      <Card className="card-flush">
        <div className="card-head">
          <h2>Members</h2>
          <Button variant="secondary" size="sm" icon={<UserPlus size={13} />} onClick={() => setAdding(true)}>
            Add member
          </Button>
        </div>
        {t.members.length === 0 ? (
          <EmptyState compact title="No members yet" description="Add people and pick who manages the team." />
        ) : (
          <ul className="due-list">
            {[...t.members]
              .sort((a, b) => (a.role === b.role ? a.user.name.localeCompare(b.user.name) : a.role === 'manager' ? -1 : 1))
              .map((m) => (
                <li key={m.user.id} className="due-row">
                  <UserCell user={m.user} sub={m.user.title} size="sm" />
                  <span className="grow" />
                  <Select aria-label={`Role of ${m.user.name}`} value={m.role} onChange={(e) => addMember.mutate({ userId: m.user.id, role: e.target.value as TeamRole }, { onSuccess: () => toast({ title: `${m.user.name} is now ${e.target.value === 'manager' ? 'a manager' : 'a member'}`, tone: 'ok' }) })}>
                    <option value="member">Member</option>
                    <option value="manager">Manager</option>
                  </Select>
                  {m.role === 'manager' && <Badge tone="accent">manager</Badge>}
                  <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${m.user.name}`} icon={<UserMinus size={13} />} onClick={() => removeMember.mutate(m.user.id, { onSuccess: () => toast({ title: `${m.user.name} removed from ${t.name}`, tone: 'neutral' }) })} />
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Dialog open={adding} onOpenChange={setAdding} title={`Add to ${t.name}`} description="Managers see the team dashboard and can assign work to it.">
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Person">
            {({ id: fid }) => (
              <Select id={fid} value={newUser} onChange={(e) => setNewUser(e.target.value)}>
                <option value="">Choose…</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Role">
            {({ id: fid }) => (
              <Select id={fid} value={newRole} onChange={(e) => setNewRole(e.target.value as TeamRole)}>
                <option value="member">Member</option>
                <option value="manager">Manager</option>
              </Select>
            )}
          </Field>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newUser}
              loading={addMember.isPending}
              onClick={() =>
                addMember.mutate(
                  { userId: newUser, role: newRole },
                  {
                    onSuccess: () => {
                      toast({ title: 'Member added', tone: 'ok' });
                      setAdding(false);
                      setNewUser('');
                    },
                  },
                )
              }
            >
              Add
            </Button>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${t.name}?`}
        description="Members keep their accounts and other teams. Assignments targeted at this team are removed; attempts are kept."
        confirmLabel="Delete team"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate(id, { onSuccess: () => (setConfirmDelete(false), toast({ title: `${t.name} deleted`, tone: 'neutral' })), onError: (e) => toast({ title: 'Could not delete', description: e.message, tone: 'err' }) })}
      />
    </div>
  );
}

function CreateTeamDialog({ open, onOpenChange, teams, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; teams: Team[]; onCreated: (t: Team) => void }) {
  const create = useCreateTeam();
  const { toast } = useShell();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New team" description="Teams nest; a manager of a parent team does not automatically manage its sub-teams.">
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Name" required>
          {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <Field label="Parent team">
          {({ id }) => (
            <Select id={id} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">None (top level)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length < 2}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), parentId: parentId || null },
                {
                  onSuccess: (t) => {
                    toast({ title: `${t.name} created`, tone: 'ok' });
                    onOpenChange(false);
                    setName('');
                    onCreated(t);
                  },
                  onError: (e) => toast({ title: 'Could not create', description: e.message, tone: 'err' }),
                },
              )
            }
          >
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
