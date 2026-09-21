/**
 * Token fetch-and-cache for Alloy Navigator's OAuth2 client_credentials
 * grant. Alloy Navigator issues a bearer access token valid for 8 hours
 * (per the API User's Guide's "Authenticating applications" article) rather
 * than a static API key - a long-running connector process needs to fetch
 * one, reuse it until it's near expiry, and fetch a replacement rather than
 * re-authenticating on every call.
 */
import { AlloyApiError, AlloyAuthError } from './types.js';
import type { AlloyCredentials } from './types.js';
import { logger } from './utils/logger.js';

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Keyed by `${baseUrl}::${clientId}` so distinct customers' credentials
 * (arriving per-request in gateway mode via runWithCredentials in
 * client.ts) never share a cached token. This is purely a latency
 * optimization over a vendor-documented 8-hour token lifetime -
 * re-fetching a token on every call would behave identically, just
 * slower; the cache never holds a token for longer than Alloy Navigator
 * itself already considers it valid.
 */
const tokenCache = new Map<string, CachedToken>();

/** Refresh this many seconds before the vendor's own expiry, so a token can't go stale mid-flight on a slow request. */
const EXPIRY_SKEW_SECONDS = 60;

function cacheKey(creds: AlloyCredentials): string {
  return `${creds.baseUrl}::${creds.clientId}`;
}

async function fetchToken(creds: AlloyCredentials): Promise<CachedToken> {
  const base = creds.baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new AlloyAuthError(`Alloy Navigator rejected the application credentials (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AlloyApiError(`Alloy Navigator token request failed: HTTP ${res.status} ${body}`.trim(), res.status);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new AlloyAuthError('Alloy Navigator token response did not include an access_token.');
  }
  const expiresInSeconds = typeof data.expires_in === 'number' ? data.expires_in : 8 * 60 * 60;
  const expiresAt = Date.now() + Math.max(0, expiresInSeconds - EXPIRY_SKEW_SECONDS) * 1000;
  return { accessToken: data.access_token, expiresAt };
}

/** Returns a currently-valid bearer token for these credentials, fetching (and caching) a new one only when none is cached or the cached one is within the expiry skew window. */
export async function getAccessToken(creds: AlloyCredentials): Promise<string> {
  const key = cacheKey(creds);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }
  const token = await fetchToken(creds);
  tokenCache.set(key, token);
  logger.debug('Fetched new Alloy Navigator access token', { baseUrl: creds.baseUrl });
  return token.accessToken;
}

/** Drops any cached token for these credentials - used when a request comes back 401 with a token our clock still considers valid (clock skew, or server-side revocation), so the next call re-authenticates instead of retrying with the same stale token. */
export function invalidateToken(creds: AlloyCredentials): void {
  tokenCache.delete(cacheKey(creds));
}

/** Test-only: clears the entire cache so tests don't leak tokens across cases. Not used by any production code path. */
export function resetTokenCache(): void {
  tokenCache.clear();
}
