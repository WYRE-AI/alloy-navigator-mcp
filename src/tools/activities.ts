import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getObjectActivities } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, LIST_PARAMS_PROPERTIES, requireCredentials, textResult } from './shared.js';

export const ACTIVITY_TOOLS: Tool[] = [
  {
    name: 'alloy_get_object_activities',
    description:
      "Get the activity/history log entries recorded against a single Alloy Navigator object by its OID - e.g. status changes, assignment changes, and system-generated notes.",
    inputSchema: {
      type: 'object',
      properties: {
        oid: {
          type: 'string',
          description: "The object's OID (from alloy_list_objects or alloy_get_object).",
        },
        ...LIST_PARAMS_PROPERTIES,
      },
      required: ['oid'],
    },
  },
];

const TOOL_NAMES = new Set(ACTIVITY_TOOLS.map((t) => t.name));
export function isActivityTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export async function handleActivityTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'alloy_get_object_activities') {
      return textResult(
        await getObjectActivities(creds!, {
          oid: args.oid as string,
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
