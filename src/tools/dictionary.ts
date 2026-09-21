import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getDictionary } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, FILTERS_PROPERTY, LIST_PARAMS_PROPERTIES, requireCredentials, textResult } from './shared.js';

export const DICTIONARY_TOOLS: Tool[] = [
  {
    name: 'alloy_get_dictionary',
    description:
      "Get the allowed reference/classification values for a field on an Alloy Navigator object class - e.g. the valid Status or Types values for Incidents or Computers. Useful for resolving what a status/type code means, or for building a valid filter value for alloy_list_objects.",
    inputSchema: {
      type: 'object',
      properties: {
        objectClass: {
          type: 'string',
          description: "The Alloy Navigator object class the reference field belongs to, e.g. 'Computers'.",
        },
        refField: {
          type: 'string',
          description: "The reference field name, e.g. 'Status' or 'Types'.",
        },
        ...FILTERS_PROPERTY,
        ...LIST_PARAMS_PROPERTIES,
      },
      required: ['objectClass', 'refField'],
    },
  },
];

const TOOL_NAMES = new Set(DICTIONARY_TOOLS.map((t) => t.name));
export function isDictionaryTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleDictionaryTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'alloy_get_dictionary') {
      return textResult(
        await getDictionary(creds!, {
          objectClass: args.objectClass as string,
          refField: args.refField as string,
          filters: args.filters as Record<string, string> | undefined,
          par_fields: args.par_fields as string | undefined,
          par_sort_asc: args.par_sort_asc as string | undefined,
          par_sort_desc: args.par_sort_desc as string | undefined,
          par_limit: args.par_limit as number | undefined,
          par_offset: args.par_offset as number | undefined,
        })
      );
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
