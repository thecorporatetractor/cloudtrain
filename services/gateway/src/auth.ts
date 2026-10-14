import type { FastifyRequest } from 'fastify';
import type { Role, TeamRole } from '@cloudtrain/api-types';

/**
 * The authenticated caller in its active org. Built per request by an
 * `Authenticator` (OIDC session + database; tests: DevAuthenticator), so
 * handlers never care how identity was established.
 */
export interface Principal {
  /** Keycloak sub (users.id). */
  sub: string;
  name: string;
  email: string;
  title?: string;
  /** Active org id; '' when the user has no org selected (platform admin without membership). */
  orgId: string;
  orgName: string;
  orgSlug: string;
  /** Display name of the first team (legacy `Learner.team`). */
  team: string;
  /** Roles in the active org, plus `platform_admin`. */
  roles: Role[];
  teams: { id: string; name: string; role: TeamRole }[];
  managedTeamIds: string[];
  /** Cohorts the principal instructs. */
  instructedCohortIds: string[];
  /** Cohorts the principal is enrolled in. */
  cohortIds: string[];
  platformAdmin: boolean;
  /** Server-side session behind the request (absent for the dev stub). */
  session?: { idHash: string; csrf: string; idp?: string; expiresAt: string; method: 'oidc' | 'dev' };
}

/**
 * Resolves the caller of a request, or null when unauthenticated (the app
 * answers 401).
 */
export interface Authenticator {
  authenticate(req: FastifyRequest): Promise<Principal | null>;
  /** True when state-changing requests must carry the session's CSRF token. */
  readonly csrf: boolean;
}

/** Tests only: every request is the same principal. Refused when NODE_ENV=production. */
export class DevAuthenticator implements Authenticator {
  readonly csrf = false;
  constructor(private readonly principal: Principal = devPrincipal()) {
    if (process.env.NODE_ENV === 'production') throw new Error('DevAuthenticator is for tests only and refuses to run with NODE_ENV=production');
  }
  async authenticate(): Promise<Principal> {
    return this.principal;
  }
}

export function devPrincipal(over: Partial<Principal> = {}): Principal {
  return {
    sub: 'dev-learner',
    name: 'Dev Learner',
    email: 'dev.learner@quillmoor.example',
    orgId: '00000000-0000-4000-8000-000000000001',
    orgName: 'Quillmoor Logistics (dev)',
    orgSlug: 'quillmoor-dev',
    team: 'Platform Operations',
    roles: ['learner'],
    teams: [],
    managedTeamIds: [],
    instructedCohortIds: [],
    cohortIds: [],
    platformAdmin: false,
    ...over,
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}
