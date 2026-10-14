#!/usr/bin/env node
// Generates the Keycloak realm imports in ./import from ../people.json.
//   node deploy/dev/keycloak/gen-realms.mjs
//
// DEV ONLY: client secrets and user passwords below are published development
// credentials for fictional people. Organizations (and their IdP links and
// domains) are not part of the import: the gateway's `kc:sync` creates them
// from the database through the admin REST API, the same code path the admin
// UI uses (services/gateway/src/keycloak).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const people = JSON.parse(readFileSync(path.join(here, '../people.json'), 'utf8'));
const PASSWORD = people.password;

const KC_PUBLIC = 'http://localhost:8180';
// Keycloak calling itself (token/JWKS/userinfo of the brokered realm) from inside the container.
const KC_INTERNAL = 'http://localhost:8080';

export const SECRETS = {
  gateway: 'gateway-dev-only-secret',
  gatewayAdmin: 'gateway-admin-dev-only-secret',
  acmeBroker: 'acme-broker-dev-only-secret',
};

const APP_ROLES = ['CloudTrain.Learner', 'CloudTrain.Manager', 'CloudTrain.Instructor', 'CloudTrain.Author', 'CloudTrain.OrgAdmin', 'CloudTrain.PlatformAdmin'];

const credential = () => [{ type: 'password', value: PASSWORD, temporary: false }];

const requiredActions = [
  ['CONFIGURE_TOTP', 'Configure OTP', 10],
  ['TERMS_AND_CONDITIONS', 'Terms and Conditions', 20, false],
  ['UPDATE_PASSWORD', 'Update Password', 30],
  ['UPDATE_PROFILE', 'Update Profile', 40],
  ['VERIFY_EMAIL', 'Verify Email', 50],
  ['delete_account', 'Delete Account', 60, false],
  ['webauthn-register', 'Webauthn Register', 70],
  ['webauthn-register-passwordless', 'Webauthn Register Passwordless', 80],
  ['update_user_locale', 'Update User Locale', 1000],
].map(([alias, name, priority, enabled = true]) => ({ alias, name, providerId: alias, enabled, defaultAction: false, priority, config: {} }));

const attrMapper = (name, attribute, claim) => ({
  name,
  protocol: 'openid-connect',
  protocolMapper: 'oidc-usermodel-attribute-mapper',
  consentRequired: false,
  config: {
    'user.attribute': attribute,
    'claim.name': claim,
    'jsonType.label': 'String',
    multivalued: 'true',
    'aggregate.attrs': 'true',
    'id.token.claim': 'true',
    'access.token.claim': 'true',
    'userinfo.token.claim': 'true',
    'introspection.token.claim': 'true',
  },
});

/* ------------------------------------------------------------------ cloudtrain */

const quillmoor = people.orgs.find((o) => o.slug === 'quillmoor');
const acme = people.orgs.find((o) => o.slug === 'acme-freight');

const localUser = (p, domain) => ({
  id: p.id,
  username: p.username,
  email: p.email ?? `${p.username}@${domain}`,
  emailVerified: true,
  enabled: true,
  firstName: p.first,
  lastName: p.last,
  attributes: { title: [p.title] },
  credentials: credential(),
});

const cloudtrain = {
  realm: 'cloudtrain',
  displayName: 'CloudTrain',
  enabled: true,
  organizationsEnabled: true,
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  resetPasswordAllowed: true,
  rememberMe: true,
  verifyEmail: false,
  bruteForceProtected: true,
  sslRequired: 'external',
  accessTokenLifespan: 300,
  ssoSessionIdleTimeout: 28800,
  ssoSessionMaxLifespan: 36000,
  // MFA and passkeys are available (users can enrol, org policy can require them).
  otpPolicyType: 'totp',
  otpPolicyAlgorithm: 'HmacSHA1',
  otpPolicyDigits: 6,
  otpPolicyPeriod: 30,
  otpSupportedApplications: ['totpAppFreeOTPName', 'totpAppGoogleName', 'totpAppMicrosoftAuthenticatorName'],
  webAuthnPolicyPasswordlessRpEntityName: 'CloudTrain',
  webAuthnPolicyPasswordlessUserVerificationRequirement: 'required',
  webAuthnPolicyPasswordlessResidentKey: 'Yes',
  webAuthnPolicyPasswordlessPasskeysEnabled: true,
  webAuthnPolicyRpEntityName: 'CloudTrain',
  requiredActions,
  smtpServer: { host: 'mailpit', port: '1025', from: 'no-reply@cloudtrain.local', fromDisplayName: 'CloudTrain (dev)' },
  clients: [
    {
      clientId: 'cloudtrain-gateway',
      name: 'CloudTrain gateway (BFF)',
      enabled: true,
      publicClient: false,
      clientAuthenticatorType: 'client-secret',
      secret: SECRETS.gateway,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      implicitFlowEnabled: false,
      serviceAccountsEnabled: false,
      frontchannelLogout: false,
      redirectUris: ['http://localhost:8787/api/auth/callback', 'http://127.0.0.1:8787/api/auth/callback', 'http://localhost:5173/api/auth/callback'],
      webOrigins: ['+'],
      attributes: {
        'pkce.code.challenge.method': 'S256',
        'post.logout.redirect.uris': 'http://localhost:8787/*##http://127.0.0.1:8787/*##http://localhost:5173/*',
        'backchannel.logout.url': 'http://host.docker.internal:8787/api/auth/backchannel-logout',
        'backchannel.logout.session.required': 'true',
        'backchannel.logout.revoke.offline.tokens': 'false',
      },
      defaultClientScopes: ['web-origins', 'acr', 'profile', 'roles', 'basic', 'email'],
      optionalClientScopes: ['organization', 'offline_access'],
      protocolMappers: [
        attrMapper('idp roles', 'idp_roles', 'idp_roles'),
        attrMapper('idp groups', 'idp_groups', 'idp_groups'),
        {
          name: 'identity provider',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-usersessionmodel-note-mapper',
          config: { 'user.session.note': 'identity_provider', 'claim.name': 'identity_provider', 'jsonType.label': 'String', 'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true' },
        },
        {
          name: 'title',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-usermodel-attribute-mapper',
          config: { 'user.attribute': 'title', 'claim.name': 'title', 'jsonType.label': 'String', 'id.token.claim': 'true', 'access.token.claim': 'false', 'userinfo.token.claim': 'true' },
        },
      ],
    },
    {
      clientId: 'cloudtrain-gateway-admin',
      name: 'CloudTrain gateway (Keycloak admin API)',
      enabled: true,
      publicClient: false,
      clientAuthenticatorType: 'client-secret',
      secret: SECRETS.gatewayAdmin,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: true,
    },
  ],
  identityProviders: [
    {
      alias: acme.idp.alias,
      displayName: acme.idp.displayName,
      providerId: 'oidc',
      enabled: true,
      trustEmail: true,
      storeToken: false,
      firstBrokerLoginFlowAlias: 'first broker login',
      config: {
        authorizationUrl: `${KC_PUBLIC}/realms/acme-idp/protocol/openid-connect/auth`,
        tokenUrl: `${KC_INTERNAL}/realms/acme-idp/protocol/openid-connect/token`,
        userInfoUrl: `${KC_INTERNAL}/realms/acme-idp/protocol/openid-connect/userinfo`,
        jwksUrl: `${KC_INTERNAL}/realms/acme-idp/protocol/openid-connect/certs`,
        logoutUrl: `${KC_PUBLIC}/realms/acme-idp/protocol/openid-connect/logout`,
        issuer: `${KC_PUBLIC}/realms/acme-idp`,
        clientId: 'cloudtrain-broker',
        clientSecret: SECRETS.acmeBroker,
        clientAuthMethod: 'client_secret_post',
        defaultScope: 'openid profile email',
        validateSignature: 'true',
        useJwksUrl: 'true',
        pkceEnabled: 'true',
        pkceMethod: 'S256',
        syncMode: 'FORCE',
        backchannelSupported: 'false',
      },
    },
  ],
  identityProviderMappers: [
    { name: 'app roles', identityProviderAlias: acme.idp.alias, identityProviderMapper: 'oidc-user-attribute-idp-mapper', config: { syncMode: 'FORCE', claim: 'roles', 'user.attribute': 'idp_roles' } },
    { name: 'groups', identityProviderAlias: acme.idp.alias, identityProviderMapper: 'oidc-user-attribute-idp-mapper', config: { syncMode: 'FORCE', claim: 'groups', 'user.attribute': 'idp_groups' } },
  ],
  users: [
    ...quillmoor.people.map((p) => localUser(p, quillmoor.domains[0])),
    ...people.platformAdmins.map((p) => localUser(p, 'cloudtrain-ops.example')),
    {
      username: 'service-account-cloudtrain-gateway-admin',
      enabled: true,
      serviceAccountClientId: 'cloudtrain-gateway-admin',
      clientRoles: { 'realm-management': ['manage-users', 'view-users', 'query-users', 'manage-identity-providers', 'view-identity-providers', 'manage-realm', 'view-realm'] },
    },
  ],
};

/* -------------------------------------------------------------------- acme-idp */

const acmeDomain = acme.domains[0];
const acmeIdp = {
  realm: 'acme-idp',
  displayName: 'Acme Freight corporate login (fictional external IdP)',
  enabled: true,
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  sslRequired: 'external',
  groups: [...new Set(acme.people.flatMap((p) => p.groups))].map((name) => ({ name, path: `/${name}` })),
  clients: [
    {
      clientId: 'cloudtrain-broker',
      name: 'CloudTrain (Keycloak broker)',
      enabled: true,
      publicClient: false,
      clientAuthenticatorType: 'client-secret',
      secret: SECRETS.acmeBroker,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [`${KC_PUBLIC}/realms/cloudtrain/broker/${acme.idp.alias}/endpoint*`],
      attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': `${KC_PUBLIC}/*` },
      defaultClientScopes: ['web-origins', 'acr', 'profile', 'roles', 'basic', 'email'],
      protocolMappers: [
        {
          // Same shape as Entra ID app roles: a `roles` array of role values.
          name: 'app roles',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-usermodel-client-role-mapper',
          config: { 'usermodel.clientRoleMapping.clientId': 'cloudtrain-broker', 'claim.name': 'roles', 'jsonType.label': 'String', multivalued: 'true', 'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true' },
        },
        {
          name: 'groups',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-group-membership-mapper',
          config: { 'claim.name': 'groups', 'full.path': 'false', 'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true' },
        },
      ],
    },
  ],
  roles: { client: { 'cloudtrain-broker': APP_ROLES.map((name) => ({ name, clientRole: true })) } },
  users: acme.people.map((p) => ({
    id: p.idpId,
    username: p.username,
    email: `${p.username}@${acmeDomain}`,
    emailVerified: true,
    enabled: true,
    firstName: p.first,
    lastName: p.last,
    credentials: credential(),
    clientRoles: { 'cloudtrain-broker': p.appRoles },
    groups: p.groups.map((g) => `/${g}`),
  })),
};

for (const [name, realm] of [['cloudtrain', cloudtrain], ['acme-idp', acmeIdp]]) {
  writeFileSync(path.join(here, 'import', `${name}-realm.json`), JSON.stringify(realm, null, 2) + '\n');
}
console.log('wrote', path.join(here, 'import'));
