import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../tools/index.js';

/**
 * Hard scope boundary (see README's Scope section): this connector must
 * NEVER expose a tool that creates, updates, deletes, or executes a
 * workflow action - Alloy Navigator's API exposes object creation and
 * mutation exclusively through workflow actions
 * (POST /object/<oid>/action/<actionId>), and none of that belongs in a
 * read-only connector. Pin the exact tool set so an accidental addition
 * fails this test immediately rather than silently shipping.
 */
describe('ALL_TOOLS scope boundary', () => {
  const EXPECTED_TOOL_NAMES = [
    'alloy_list_objects',
    'alloy_get_object',
    'alloy_get_object_activities',
    'alloy_get_dictionary',
  ].sort();

  it("exposes exactly this connector's 4 read-only tools - nothing more, nothing less", () => {
    const names = ALL_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
    expect(names).toHaveLength(4);
  });

  it('never exposes a write, workflow-action, create, update, or delete tool', () => {
    // Forbidden as a whole underscore-token, not a substring - so this does
    // NOT false-positive on legitimate tokens like 'update' inside a word
    // like 'updated' (none exist here, but the discipline matches the
    // sibling connectors' tool-scope tests).
    const FORBIDDEN_TOKENS = new Set([
      'create',
      'update',
      'delete',
      'execute',
      'action',
      'workflow',
      'move',
      'clone',
      'merge',
      'close',
      'assign',
      'resolve',
      'login',
      'logout',
      'post',
      'put',
      'patch',
    ]);

    for (const tool of ALL_TOOLS) {
      const tokens = tool.name.split('_');
      for (const token of tokens) {
        expect(
          FORBIDDEN_TOKENS.has(token),
          `Tool "${tool.name}" contains forbidden token "${token}" - this connector must stay read-only.`
        ).toBe(false);
      }
    }
  });

  it('every tool name is prefixed with alloy_', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name.startsWith('alloy_')).toBe(true);
    }
  });
});
