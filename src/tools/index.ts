import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ACTIVITY_TOOLS, handleActivityTool, isActivityTool } from './activities.js';
import { DICTIONARY_TOOLS, handleDictionaryTool, isDictionaryTool } from './dictionary.js';
import { OBJECT_TOOLS, handleObjectTool, isObjectTool } from './objects.js';
import type { CallToolResult } from './types.js';

export const ALL_TOOLS: Tool[] = [
  ...OBJECT_TOOLS,
  ...ACTIVITY_TOOLS,
  ...DICTIONARY_TOOLS,
];

export async function dispatchToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (isObjectTool(name)) return handleObjectTool(name, args);
  if (isActivityTool(name)) return handleActivityTool(name, args);
  if (isDictionaryTool(name)) return handleDictionaryTool(name, args);
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}
