import type { AlloyCredentials } from '../types.js';
import type { CallToolResult } from './types.js';

export function textResult(value: unknown): CallToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** Returns an error CallToolResult if credentials are missing, else null. */
export function requireCredentials(creds: AlloyCredentials | null): CallToolResult | null {
  if (!creds) {
    return errorResult(
      'No Alloy Navigator credentials configured. Set ALLOY_BASE_URL, ALLOY_CLIENT_ID, and ALLOY_CLIENT_SECRET.'
    );
  }
  return null;
}

/** Shared par_fields/par_sort_asc/par_sort_desc/par_limit/par_offset input-schema fragment, present on every Alloy Navigator API v2 GET endpoint that returns a Fields/Data table. */
export const LIST_PARAMS_PROPERTIES = {
  par_fields: {
    type: 'string',
    description: 'Comma-separated list of field names to include in the result. Omit to return every field.',
  },
  par_sort_asc: {
    type: 'string',
    description: 'Comma-separated list of field names to sort the result by, ascending.',
  },
  par_sort_desc: {
    type: 'string',
    description: 'Comma-separated list of field names to sort the result by, descending.',
  },
  par_limit: {
    type: 'number',
    description: 'Maximum number of records to return.',
  },
  par_offset: {
    type: 'number',
    description: 'Number of records to skip, for paging.',
  },
} as const;

/** Generic per-field equality filters (e.g. {"Priority": "High"}), appended to the query string as literal <fieldName>=<value> pairs - Alloy Navigator's own filtering convention (see e.g. `Rank=3` in the Dictionary endpoint's documented example). */
export const FILTERS_PROPERTY = {
  filters: {
    type: 'object',
    description:
      'Optional field-name/value pairs to filter the result, e.g. {"Priority": "High"}. Each pair is sent as a literal <fieldName>=<value> query parameter, matching Alloy Navigator\'s own filtering convention.',
    additionalProperties: { type: 'string' },
  },
} as const;
