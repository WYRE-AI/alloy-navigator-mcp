/**
 * Alloy Navigator authenticates application accounts via the OAuth2
 * client_credentials grant against `<baseUrl>/api/token`, returning a
 * bearer access token valid for 8 hours. Unlike a static API key, every
 * request needs a currently-valid token - see auth.ts for the
 * fetch-and-cache logic. Alloy Navigator has no fixed hosted API endpoint:
 * every instance (on-premises or a customer's own self-hosted-cloud
 * tenant) is its own base URL, so a base URL is a required part of the
 * credential. See README's Authentication section.
 */
export interface AlloyCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

/** Thrown when Alloy Navigator rejects the application credentials or an access token (HTTP 401/403) - distinct from rate limiting so callers get an honest error. */
export class AlloyAuthError extends Error {}

/** Thrown when Alloy Navigator rate-limits the request (HTTP 429) - distinct from an auth failure. */
export class AlloyRateLimitError extends Error {}

/** Thrown for any other non-2xx / unexpected vendor response. */
export class AlloyApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Shared par_fields/par_sort_asc/par_sort_desc/par_limit/par_offset params, present on every Alloy Navigator API v2 GET endpoint that returns a Fields/Data table. */
export interface ListParams {
  par_fields?: string;
  par_sort_asc?: string;
  par_sort_desc?: string;
  par_limit?: number;
  par_offset?: number;
}

export interface ListObjectsParams extends ListParams {
  objectClass: string;
  /** Free-text search string, sent as `par_search_text`. */
  par_search_text?: string;
  /** Per-field equality filters, sent as literal `<fieldName>=<value>` query parameters (Alloy Navigator's own filtering convention - see e.g. `Rank=3` in the Dictionary endpoint's documented example). */
  filters?: Record<string, string>;
}

export interface GetObjectParams {
  /** The object's OID (e.g. a ticket number like `T000002`) or database record GUID. */
  oid: string;
}

export interface GetActivitiesParams extends ListParams {
  oid: string;
}

export interface GetDictionaryParams extends ListParams {
  objectClass: string;
  refField: string;
  filters?: Record<string, string>;
}

/**
 * Alloy Navigator API v2 response bodies are passed through as received -
 * this connector doesn't re-model Alloy's full field set, only what a
 * caller needs to page and chain calls. See each tool's own JSDoc.
 */
export type AlloyResponse = unknown;
