import { env } from './env.js';

/**
 * Derived Keycloak endpoint URLs. Centralized here so nothing else in the framework
 * hardcodes Keycloak's OIDC path shape.
 */
export const keycloakConfig = {
  baseUrl: env.KEYCLOAK_BASE_URL,
  realm: env.KEYCLOAK_REALM,
  clientId: env.KEYCLOAK_CLIENT_ID,
  clientSecret: env.KEYCLOAK_CLIENT_SECRET || undefined,

  get realmUrl(): string {
    return `${this.baseUrl}/realms/${this.realm}`;
  },
  get authorizeUrl(): string {
    return `${this.realmUrl}/protocol/openid-connect/auth`;
  },
  get tokenUrl(): string {
    return `${this.realmUrl}/protocol/openid-connect/token`;
  },
  get logoutUrl(): string {
    return `${this.realmUrl}/protocol/openid-connect/logout`;
  },
  /** Requires a valid bearer token; 401s without one — useful as a real "protected endpoint". */
  get userInfoUrl(): string {
    return `${this.realmUrl}/protocol/openid-connect/userinfo`;
  },
};
