import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleObjectTool } from '../tools/objects.js';
import { runWithCredentials } from '../client.js';
import { resetTokenCache } from '../auth.js';
import { jsonResponse, textOf, tokenResponse } from './test-helpers.js';

describe('handleObjectTool', () => {
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

  it('alloy_list_objects fetches a token then sends the Bearer token and forwards filters/params', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        errorCode: 0,
        responseObject: { Fields: [{ Name: 'OID', DataType: 'string' }], Data: [['T000001']] },
      })
    );

    const result = await runWithCredentials(creds, () =>
      handleObjectTool('alloy_list_objects', {
        objectClass: 'Incidents',
        filters: { Priority: 'High' },
        par_fields: 'OID,Summary',
        par_limit: 10,
      })
    );

    expect(result.isError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(tokenUrl).pathname).toBe('/api/token');
    expect(JSON.parse(tokenInit.body as string).grant_type).toBe('client_credentials');

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/v2/Incidents');
    expect(new URL(url).searchParams.get('Priority')).toBe('High');
    expect(new URL(url).searchParams.get('par_fields')).toBe('OID,Summary');
    expect(new URL(url).searchParams.get('par_limit')).toBe('10');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(textOf(result)).responseObject.Data[0][0]).toBe('T000001');
  });

  it('reuses a cached token across two calls instead of re-authenticating', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, responseObject: { Fields: [], Data: [] } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, responseObject: { Fields: [], Data: [] } }));

    await runWithCredentials(creds, () => handleObjectTool('alloy_list_objects', { objectClass: 'Incidents' }));
    await runWithCredentials(creds, () => handleObjectTool('alloy_list_objects', { objectClass: 'Computers' }));

    // 1 token fetch + 2 API calls, not 2 token fetches + 2 API calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('alloy_get_object scopes the request to the OID in the path', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, responseObject: { Items: [{ name: 'Ticket', caption: 'Ticket', value: 'T000002' }] } })
    );

    const result = await runWithCredentials(creds, () => handleObjectTool('alloy_get_object', { oid: 'T000002' }));

    expect(new URL(fetchMock.mock.calls[1][0] as string).pathname).toBe('/api/v2/object/T000002');
    expect(result.isError).toBeUndefined();
  });

  it('surfaces a 401 on the API call as a readable auth error after retrying once with a fresh token', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1'));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-2'));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));

    const result = await runWithCredentials(creds, () =>
      handleObjectTool('alloy_list_objects', { objectClass: 'Incidents' })
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/rejected the request/i);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('surfaces a rejected token exchange as a readable error without calling the API', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 401));

    const result = await runWithCredentials(creds, () =>
      handleObjectTool('alloy_list_objects', { objectClass: 'Incidents' })
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/rejected the application credentials/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 429 as a rate-limit error', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'rate_limited' }, 429));

    const result = await runWithCredentials(creds, () =>
      handleObjectTool('alloy_list_objects', { objectClass: 'Incidents' })
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/rate-limited/i);
  });

  it('returns a credential error without calling fetch when no credentials are configured', async () => {
    const result = await handleObjectTool('alloy_list_objects', { objectClass: 'Incidents' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/ALLOY_BASE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool name', async () => {
    const result = await runWithCredentials(creds, () => handleObjectTool('alloy_delete_object', {}));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Unknown tool/);
  });
});
