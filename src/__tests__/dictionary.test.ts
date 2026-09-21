import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDictionaryTool } from '../tools/dictionary.js';
import { runWithCredentials } from '../client.js';
import { resetTokenCache } from '../auth.js';
import { jsonResponse, textOf, tokenResponse } from './test-helpers.js';

describe('handleDictionaryTool', () => {
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

  it('alloy_get_dictionary hits /Dictionary with par_objectClass/par_refField and forwards filters', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        responseObject: {
          Fields: [{ Name: 'Rank', DataType: 'int' }, { Name: 'Status', DataType: 'string' }],
          Data: [['2', 'In Stock']],
        },
      })
    );

    const result = await runWithCredentials(creds, () =>
      handleDictionaryTool('alloy_get_dictionary', {
        objectClass: 'Computers',
        refField: 'Status',
        filters: { Rank: '3' },
      })
    );

    expect(result.isError).toBeUndefined();
    const [url] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/v2/Dictionary');
    expect(new URL(url).searchParams.get('par_objectClass')).toBe('Computers');
    expect(new URL(url).searchParams.get('par_refField')).toBe('Status');
    expect(new URL(url).searchParams.get('Rank')).toBe('3');
  });

  it('returns a credential error without calling fetch when no credentials are configured', async () => {
    const result = await handleDictionaryTool('alloy_get_dictionary', { objectClass: 'Computers', refField: 'Status' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/ALLOY_BASE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
