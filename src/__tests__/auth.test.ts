import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, invalidateToken, resetTokenCache } from '../auth.js';
import { jsonResponse, tokenResponse } from './test-helpers.js';

describe('getAccessToken', () => {
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

  it('POSTs client_credentials to /api/token and returns the access token', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1'));

    const token = await getAccessToken(creds);

    expect(token).toBe('tok-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/token');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ grant_type: 'client_credentials', client_id: 'client-1', client_secret: 'secret-1' });
  });

  it('caches the token and does not re-fetch on a second call', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1'));

    await getAccessToken(creds);
    await getAccessToken(creds);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches a fresh token after invalidateToken clears the cache', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1'));
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-2'));

    const first = await getAccessToken(creds);
    invalidateToken(creds);
    const second = await getAccessToken(creds);

    expect(first).toBe('tok-1');
    expect(second).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a token within the expiry skew window as already expired and fetches a fresh one', async () => {
    // expires_in: 30 is inside the 60s skew window, so the cached copy
    // should never be considered valid.
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1', 30));
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-2'));

    const first = await getAccessToken(creds);
    const second = await getAccessToken(creds);

    expect(first).toBe('tok-1');
    expect(second).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches tokens per credential set - different clientId does not reuse a cached token', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-1'));
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-2'));

    const first = await getAccessToken(creds);
    const second = await getAccessToken({ ...creds, clientId: 'client-2' });

    expect(first).toBe('tok-1');
    expect(second).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a readable auth error when the token endpoint rejects the credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 401));

    await expect(getAccessToken(creds)).rejects.toThrow(/rejected the application credentials/i);
  });

  it('throws a readable error when the token endpoint returns a non-auth failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'server_error' }, 500));

    await expect(getAccessToken(creds)).rejects.toThrow(/token request failed/i);
  });

  it('throws when the token response has no access_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ token_type: 'bearer' }));

    await expect(getAccessToken(creds)).rejects.toThrow(/did not include an access_token/i);
  });
});
