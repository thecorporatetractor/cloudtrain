import type { FastifyRequest } from 'fastify';

/**
 * The authenticated caller. Field names follow the OIDC claims Keycloak will
 * issue (`sub`, `name`, `email`, plus the CloudTrain `org_id` and realm roles),
 * so swapping the dev stub for token verification does not touch handlers.
 */
export interface Principal {
  sub: string;
  name: string;
  email: string;
  orgId: string;
  orgName: string;
  team: string;
  roles: Array<'learner' | 'manager' | 'admin'>;
}

/**
 * Resolves the caller of a request, or null when unauthenticated (the app
 * answers 401). An OIDC implementation verifies the bearer token / session
 * cookie here; nothing else in the gateway knows how identity is established.
 */
export interface Authenticator {
  authenticate(req: FastifyRequest): Promise<Principal | null>;
}

/** Development only: every request is the same stub user. No Keycloak yet. */
export class DevAuthenticator implements Authenticator {
  constructor(private readonly principal: Principal = devPrincipal()) {}
  async authenticate(): Promise<Principal> {
    return this.principal;
  }
}

export function devPrincipal(env: NodeJS.ProcessEnv = process.env): Principal {
  return {
    sub: env.CT_DEV_USER_ID ?? 'dev-learner',
    name: env.CT_DEV_USER_NAME ?? 'Dev Learner',
    email: env.CT_DEV_USER_EMAIL ?? 'dev.learner@quillmoor.example',
    orgId: env.CT_DEV_ORG_ID ?? 'org-quillmoor-dev',
    orgName: env.CT_DEV_ORG_NAME ?? 'Quillmoor Logistics (dev)',
    team: 'Platform Operations',
    roles: ['admin'],
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}
