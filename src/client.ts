import { AsyncLocalStorage } from 'node:async_hooks';
import { getAccessToken, invalidateToken } from './auth.js';
import { logger } from './utils/logger.js';
import { AlloyApiError, AlloyAuthError, AlloyRateLimitError } from './types.js';
import type {
  AlloyCredentials,
  AlloyResponse,
  GetActivitiesParams,
  GetDictionaryParams,
  GetObjectParams,
  ListObjectsParams,
} from './types.js';

// Request-scoped credential store. In gateway mode the HTTP layer runs each
// request inside runWithCredentials({baseUrl, clientId, clientSecret});
// getCredentials() reads from it. Falls back to process.env for
// stdio/single-tenant mode.
const credStore = new AsyncLocalStorage<AlloyCredentials>();

export function runWithCredentials<T>(creds: AlloyCredentials, fn: () => T): T {
  return credStore.run(creds, fn);
}

export function getCredentials(): AlloyCredentials | null {
  const scoped = credStore.getStore();
  if (scoped?.baseUrl && scoped?.clientId && scoped?.clientSecret) return scoped;
  const baseUrl = process.env.ALLOY_BASE_URL;
  const clientId = process.env.ALLOY_CLIENT_ID;
  const clientSecret = process.env.ALLOY_CLIENT_SECRET;
  if (!baseUrl || !clientId || !clientSecret) {
    logger.warn('Missing credentials', {
      hasBaseUrl: !!baseUrl,
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
    });
    return null;
  }
  return { baseUrl, clientId, clientSecret };
}

function buildQuery(params: Record<string, unknown> = {}): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    qs.append(key, String(value));
  }
  return qs;
}

async function requestOnce(
  creds: AlloyCredentials,
  path: string,
  query: Record<string, unknown> | undefined,
  token: string
): Promise<Response> {
  const base = creds.baseUrl.replace(/\/+$/, '');
  const qs = query ? buildQuery(query).toString() : '';
  const url = `${base}/api/v2${path}${qs ? `?${qs}` : ''}`;
  return fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
}

async function doGet(creds: AlloyCredentials, path: string, query?: Record<string, unknown>): Promise<AlloyResponse> {
  const token = await getAccessToken(creds);
  let res = await requestOnce(creds, path, query, token);

  // A cached token can come back 401 even though our clock says it hasn't
  // expired yet (clock skew, or server-side revocation) - drop it and
  // retry exactly once with a freshly-fetched token before treating this
  // as a genuine auth failure.
  if (res.status === 401) {
    invalidateToken(creds);
    const freshToken = await getAccessToken(creds);
    res = await requestOnce(creds, path, query, freshToken);
  }

  // 401 (invalid/expired token) and 403 (token whose account lacks
  // permission to read the requested object) are both "this credential
  // can't do that", not "try again" - grouped under AlloyAuthError, same
  // shape as 429 getting its own distinct AlloyRateLimitError so a
  // transient rate limit never reads like a bad credential.
  if (res.status === 401 || res.status === 403) {
    throw new AlloyAuthError(`Alloy Navigator rejected the request (HTTP ${res.status}): ${path}`);
  }
  if (res.status === 429) {
    throw new AlloyRateLimitError(`Alloy Navigator rate-limited the request (HTTP 429): ${path}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AlloyApiError(`Alloy Navigator ${path} failed: HTTP ${res.status} ${body}`.trim(), res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------

/** GET /<objectClass> - list objects of the given class, with field selection, sorting, paging, free-text search, and per-field filters. */
export async function listObjects(
  creds: AlloyCredentials,
  { objectClass, filters, ...params }: ListObjectsParams
): Promise<AlloyResponse> {
  return doGet(creds, `/${encodeURIComponent(objectClass)}`, { ...filters, ...params });
}

/** GET /object/<oid> - every field of a single object, by OID or GUID. */
export async function getObject(creds: AlloyCredentials, { oid }: GetObjectParams): Promise<AlloyResponse> {
  return doGet(creds, `/object/${encodeURIComponent(oid)}`);
}

// ---------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------

/** GET /Activities/<oid> - the activity/history log entries recorded against a single object. */
export async function getObjectActivities(
  creds: AlloyCredentials,
  { oid, ...params }: GetActivitiesParams
): Promise<AlloyResponse> {
  return doGet(creds, `/Activities/${encodeURIComponent(oid)}`, { ...params });
}

// ---------------------------------------------------------------------
// Dictionary (reference/classification values)
// ---------------------------------------------------------------------

/** GET /Dictionary - the allowed reference/classification values (e.g. Status, Types) for a field on an object class. */
export async function getDictionary(
  creds: AlloyCredentials,
  { objectClass, refField, filters, ...params }: GetDictionaryParams
): Promise<AlloyResponse> {
  return doGet(creds, '/Dictionary', { par_objectClass: objectClass, par_refField: refField, ...filters, ...params });
}
