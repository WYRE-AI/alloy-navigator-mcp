import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleActivityTool } from '../tools/activities.js';
import { runWithCredentials } from '../client.js';
import { resetTokenCache } from '../auth.js';
import { jsonResponse, textOf, tokenResponse } from './test-helpers.js';

describe('handleActivityTool', () => {
  const fetchMock = vi.fn();
  const creds = { baseUrl: 'https://alloy.example.com', clientId: 'client-1', clientSecret: 'secret-1' };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    resetTokenCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('alloy_get_object_activities hits /Activities/<oid> with the Bearer token and forwards paging params', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        responseObject: {
          Fields: [{ Name: 'Num', DataType: 'int' }, { Name: 'Activity', DataType: 'memo' }],
          Data: [['1', 'New Technical Issue was created']],
        },
      })
    );

    const result = await runWithCredentials(creds, () =>
      handleActivityTool('alloy_get_object_activities', {
        oid: 'T000027',
        par_fields: 'Num,Activity',
        par_sort_desc: 'Num',
        par_limit: 5,
      })
    );

    expect(result.isError).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/v2/Activities/T000027');
    expect(new URL(url).searchParams.get('par_fields')).toBe('Num,Activity');
    expect(new URL(url).searchParams.get('par_sort_desc')).toBe('Num');
    expect(new URL(url).searchParams.get('par_limit')).toBe('5');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('surfaces a 403 as a readable auth error', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-2'));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));

    const result = await runWithCredentials(creds, () =>
      handleActivityTool('alloy_get_object_activities', { oid: 'T000027' })
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/rejected the request/i);
  });

  it('returns a credential error without calling fetch when no credentials are configured', async () => {
    const result = await handleActivityTool('alloy_get_object_activities', { oid: 'T000027' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/ALLOY_BASE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
