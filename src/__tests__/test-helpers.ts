import type { CallToolResult } from '../tools/types.js';

/** Extracts the text of the first content block, failing loudly if it isn't text. */
export function textOf(result: CallToolResult): string {
  const block = result.content?.[0];
  if (!block || block.type !== 'text') {
    throw new Error(`Expected a text content block, got: ${JSON.stringify(block)}`);
  }
  return block.text;
}

/** Builds a Response whose body is JSON, matching Alloy Navigator's response shape. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A successful /api/token response, matching Alloy Navigator's documented shape. */
export function tokenResponse(accessToken = 'tok-1', expiresIn = 28799): Response {
  return jsonResponse({ access_token: accessToken, token_type: 'bearer', expires_in: expiresIn });
}
