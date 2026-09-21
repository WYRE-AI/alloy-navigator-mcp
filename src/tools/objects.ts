import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getObject, listObjects } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, FILTERS_PROPERTY, LIST_PARAMS_PROPERTIES, requireCredentials, textResult } from './shared.js';

export const OBJECT_TOOLS: Tool[] = [
  {
    name: 'alloy_list_objects',
    description:
      "List objects of a given Alloy Navigator object class (e.g. Incidents, Work Orders, Computers, Consumables, SoftwareCatalog, or 'Purchase Order Items' - Alloy Navigator does not publish one exhaustive class list; use the object class names configured in your instance, which typically match the module names shown in the Alloy Navigator client). Supports field selection, sorting, paging, free-text search, and per-field filters. Each returned object's OID chains into alloy_get_object and alloy_get_object_activities.",
    inputSchema: {
      type: 'object',
      properties: {
        objectClass: {
          type: 'string',
          description: "The Alloy Navigator object class to list, e.g. 'Incidents' or 'Computers'.",
        },
        par_search_text: {
          type: 'string',
          description: 'Free-text search string to narrow the returned objects.',
        },
        ...FILTERS_PROPERTY,
        ...LIST_PARAMS_PROPERTIES,
      },
      required: ['objectClass'],
    },
  },
  {
    name: 'alloy_get_object',
    description: "Get every field of a single Alloy Navigator object by its OID (e.g. a ticket number like T000002) or database record GUID.",
    inputSchema: {
      type: 'object',
      properties: {
        oid: {
          type: 'string',
          description: "The object's OID or GUID (from alloy_list_objects).",
        },
      },
      required: ['oid'],
    },
  },
];

const TOOL_NAMES = new Set(OBJECT_TOOLS.map((t) => t.name));
export function isObjectTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleObjectTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'alloy_list_objects') {
      return textResult(
        await listObjects(creds!, {
          objectClass: args.objectClass as string,
          par_search_text: args.par_search_text as string | undefined,
          filters: args.filters as Record<string, string> | undefined,
          par_fields: args.par_fields as string | undefined,
          par_sort_asc: args.par_sort_asc as string | undefined,
          par_sort_desc: args.par_sort_desc as string | undefined,
          par_limit: args.par_limit as number | undefined,
          par_offset: args.par_offset as number | undefined,
        })
      );
    }

    if (name === 'alloy_get_object') {
      return textResult(await getObject(creds!, { oid: args.oid as string }));
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
