import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const AUTH_CACHE_DIR = '.auth';

/**
 * Cache an arbitrary `storageState` JSON payload to disk, keyed by a caller-chosen name
 * (typically a username). Fixtures use this so the expensive part of authenticating — the
 * Keycloak SSO-cookie dance in `KeycloakAuth.loginForBrowserSession` — happens once per
 * worker rather than once per test.
 *
 * Writes via a temp-file-then-`rename` so a concurrent reader (a different Playwright
 * worker, running the same login for the same user because it started before this write
 * landed) never observes a half-written file — `rename` on the same filesystem is atomic,
 * a plain `writeFile` to the final path is not.
 *
 * Same-run cache only: Keycloak sessions/tokens expire, so this is not meant to survive
 * across separate CI runs. `.auth/` is gitignored.
 */
export async function writeStorageStateCache(key: string, state: unknown): Promise<string> {
  const path = pathFor(key);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(state), 'utf-8');
  await rename(tempPath, path);
  return path;
}

export async function readStorageStateCachePath(key: string): Promise<string | undefined> {
  const path = pathFor(key);
  try {
    await access(path);
    return path;
  } catch {
    return undefined;
  }
}

function pathFor(key: string): string {
  const safeKey = key.replace(/[^a-z0-9-_]/gi, '_');
  return `${AUTH_CACHE_DIR}/${safeKey}.json`;
}
