import type { AuditAction } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import type { Tx } from '../db/index.js';

export interface AuditActor {
  orgId: string;
  actorId: string | null;
  actorName?: string | null;
  ip?: string | undefined;
}

export const actorOf = (p: Principal, ip?: string, orgId = p.orgId): AuditActor => ({ orgId, actorId: p.sub, actorName: p.name, ip });

/** Appends one audit_log row (the table is append-only for the app role). */
export async function audit(tx: Tx, a: AuditActor, action: AuditAction, targetType: string, targetId: string, details: Record<string, unknown> = {}, targetLabel?: string): Promise<void> {
  await tx
    .insertInto('audit_log')
    .values({
      org_id: a.orgId,
      actor_id: a.actorId,
      actor_name: a.actorName ?? null,
      action,
      target_type: targetType,
      target_id: targetId,
      target_label: targetLabel ?? null,
      ip: a.ip ?? null,
      details: JSON.stringify(details),
    })
    .execute();
}
