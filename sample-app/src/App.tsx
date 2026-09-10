import { useEffect, useRef, useState } from 'react';
import { keycloak } from './keycloak';

/**
 * Deliberately minimal — this app exists only so the framework's Keycloak E2E specs have
 * something real to log into (`tests/e2e/ui-login.e2e.spec.ts`,
 * `tests/e2e/api-mode-login.e2e.spec.ts`). Swap it for your actual React app; the specs and
 * page objects only depend on the markup called out in `src/pages/*.page.ts`.
 */
export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  // keycloak-js throws if `init()` runs twice on the same instance. React 18's StrictMode
  // deliberately double-invokes effects in dev, so a plain `useEffect(() => init(), [])`
  // triggers that exact error — this ref makes the effect body idempotent instead of
  // dropping StrictMode.
  const initStarted = useRef(false);

  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    // `login-required` — the whole app sits behind auth, so an unauthenticated visit
    // redirects straight to Keycloak (matching what `KeycloakLoginPage`/the UI-mode E2E spec
    // expects: navigate to the app, land on the Keycloak form). A visitor with an existing
    // SSO session — including one established out-of-band by `KeycloakAuth.loginForBrowserSession`
    // — gets silently redirected back authenticated, with no form ever rendered.
    keycloak
      .init({ onLoad: 'login-required', pkceMethod: 'S256' })
      .then(setAuthenticated)
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return <p>Loading...</p>;
  }

  if (!authenticated) {
    return <p>Not authenticated.</p>;
  }

  return (
    <div>
      <h1>Welcome</h1>
      <p data-testid="authenticated-username">{keycloak.tokenParsed?.preferred_username}</p>
      <button onClick={() => keycloak.logout({ redirectUri: window.location.origin })}>
        Log out
      </button>
    </div>
  );
}
