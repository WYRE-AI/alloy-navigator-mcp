/**
 * Request / tool-input size limits.
 *
 * Addresses CVE-2026-111768 (GHSA-46jr-4wx8-v453, memory exhaustion during
 * input validation) and GHSA-f897-62hf-6gxq (no request body / batch cap).
 * Tracking: Linear WYREAI-454.
 *
 * The SDK's McpServer exposes `maxToolInputElements`, but the low-level
 * Server does not, so tool handlers call these helpers before dispatching.
 * Dependency-free on purpose: copy verbatim to other fleet repos.
 */

/** Maximum HTTP request body size in bytes (256 KiB). Inclusive: a body of exactly this size is accepted. */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;
/** Maximum array items plus object keys, at any depth, in tool-call arguments. Inclusive: exactly this many is accepted. */
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

/**
 * Count every array element and every own object key at every depth.
 * Iterative (explicit stack) so deep nesting cannot overflow the call stack,
 * and returns as soon as the running count exceeds `max`.
 */
export function countToolInputElements(value: unknown, max: number): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      count += current.length;
      if (count > max) return count;
      for (const item of current) stack.push(item);
    } else {
      const keys = Object.keys(current);
      count += keys.length;
      if (count > max) return count;
      for (const key of keys) stack.push((current as Record<string, unknown>)[key]);
    }
  }
  return count;
}

/**
 * True when `args` holds more than `max` elements (inclusive limit: exactly
 * `max` is allowed). Counting is done by {@link countToolInputElements}.
 */
export function toolInputTooLarge(args: unknown, max = MAX_TOOL_INPUT_ELEMENTS): boolean {
  return countToolInputElements(args, max) > max;
}

/**
 * Build the `isError: true` tool result returned for an oversized call.
 * The message is fixed and never echoes caller-controlled input (CWE-209).
 */
export function toolInputTooLargeResult(max = MAX_TOOL_INPUT_ELEMENTS) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Tool input exceeds the maximum of ${max} elements`,
      },
    ],
    isError: true,
  };
}
