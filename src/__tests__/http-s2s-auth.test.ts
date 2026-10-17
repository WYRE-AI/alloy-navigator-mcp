/**
 * HTTP transport fail-closed auth (CWE-306).
 *
 * Startup requires a real CONDUIT_S2S_SECRET. Known placeholders are refused
 * even when MCP_ALLOW_INSECURE_DEV=1. That flag listens on 127.0.0.1 only.
 * A configured secret honors MCP_HTTP_HOST. Gateway mode rejects /mcp
 * requests that omit X-Alloy-* credential headers and must not fall back
 * to ALLOY_* in process.env.
 */

import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../client.js';
import { startHttpServer } from '../http.js';

const S2S_SECRET = 's2s-do-not-log-7f3a';
const MIXED_CASE_SECRET = 'AbC-not-placeholder';
const ENV_CLIENT_ID = 'env-client-id-must-not-be-used';
const ENV_CLIENT_SECRET = 'env-secret-must-not-be-used';
const ENV_BASE_URL = 'https://env.example.invalid';

const ENV_KEYS = [
  'CONDUIT_S2S_SECRET',
  'MCP_ALLOW_INSECURE_DEV',
  'MCP_HTTP_PORT',
  'MCP_HTTP_HOST',
  'AUTH_MODE',
  'ALLOY_BASE_URL',
  'ALLOY_CLIENT_ID',
  'ALLOY_CLIENT_SECRET',
  'LOG_LEVEL',
  'MCP_TRANSPORT',
] as const;

const savedEnv = new Map<string, string | undefined>();
const servers: Server[] = [];

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  });
  return {
    text: () => lines.join('\n'),
    restore: () => spy.mockRestore(),
  };
}

function exitSpy() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  }) as typeof process.exit);
}

interface HttpResult {
  status: number;
  body: string;
}

function sendHttp(options: {
  port: number;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return fetch(`http://127.0.0.1:${options.port}${options.path}`, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
  }).then(async (response) => ({
    status: response.status,
    body: await response.text(),
  }));
}

async function listen(): Promise<{ port: number; address: string; server: Server }> {
  const server = await startHttpServer();
  servers.push(server);
  const bound = server.address() as AddressInfo | null;
  if (!bound || typeof bound === 'string') {
    throw new Error('HTTP server did not bind a TCP port');
  }
  return { port: bound.port, address: bound.address, server };
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  };
}

const listTools = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
});

const gatewayCredentialHeaders = {
  'x-alloy-base-url': 'https://header.example',
  'x-alloy-client-id': 'header-client-id',
  'x-alloy-client-secret': 'header-client-secret',
};

function assertNoSecrets(text: string): void {
  expect(text).not.toContain(S2S_SECRET);
  expect(text).not.toContain(MIXED_CASE_SECRET);
  expect(text).not.toContain(ENV_CLIENT_ID);
  expect(text).not.toContain(ENV_CLIENT_SECRET);
  expect(text).not.toContain(ENV_BASE_URL);
}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) continue;
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
});

beforeEach(() => {
  process.env.MCP_HTTP_PORT = '0';
  process.env.MCP_HTTP_HOST = '127.0.0.1';
  process.env.LOG_LEVEL = 'info';
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.AUTH_MODE;
  delete process.env.ALLOY_BASE_URL;
  delete process.env.ALLOY_CLIENT_ID;
  delete process.env.ALLOY_CLIENT_SECRET;
});

describe('HTTP startup', () => {
  it('refuses to start when CONDUIT_S2S_SECRET is empty', async () => {
    const logs = captureStderr();
    const exit = exitSpy();

    try {
      await expect(startHttpServer()).rejects.toThrow('process.exit:1');
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain('Refusing to start HTTP server');
      expect(text).toContain('CONDUIT_S2S_SECRET is empty');
      expect(text).toContain('MCP_ALLOW_INSECURE_DEV=1');
      assertNoSecrets(text);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it('refuses a whitespace-only secret', async () => {
    process.env.CONDUIT_S2S_SECRET = '   ';
    const logs = captureStderr();
    const exit = exitSpy();

    try {
      await expect(startHttpServer()).rejects.toThrow('process.exit:1');
      expect(logs.text()).toContain('CONDUIT_S2S_SECRET is empty');
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it.each(['true', '0', 'yes'])('still refuses when MCP_ALLOW_INSECURE_DEV is %s', async (flag) => {
    process.env.MCP_ALLOW_INSECURE_DEV = flag;
    const logs = captureStderr();
    const exit = exitSpy();

    try {
      await expect(startHttpServer()).rejects.toThrow('process.exit:1');
      expect(logs.text()).toContain('Refusing to start HTTP server');
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it.each(['changeme', 'ChangeMe', '  your-s2s-secret  ', 'replace-with-a-real-secret', 'PLACEHOLDER'])(
    'refuses known placeholder %j and does not log it',
    async (placeholder) => {
      process.env.CONDUIT_S2S_SECRET = placeholder;
      const logs = captureStderr();
      const exit = exitSpy();

      try {
        await expect(startHttpServer()).rejects.toThrow('process.exit:1');
        expect(exit).toHaveBeenCalledWith(1);
        const text = logs.text();
        expect(text).toContain('known placeholder');
        expect(text).toContain('openssl rand -hex 32');
        expect(text).not.toContain(placeholder.trim());
        assertNoSecrets(text);
      } finally {
        exit.mockRestore();
        logs.restore();
      }
    },
  );

  it('refuses a placeholder even when MCP_ALLOW_INSECURE_DEV=1', async () => {
    process.env.CONDUIT_S2S_SECRET = 'Secret';
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    const logs = captureStderr();
    const exit = exitSpy();

    try {
      await expect(startHttpServer()).rejects.toThrow('process.exit:1');
      const text = logs.text();
      expect(text).toContain('known placeholder');
      expect(text).not.toContain('SECURITY WARNING');
      expect(text).not.toMatch(/\bSecret\b/);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it('allows startup with a warning when MCP_ALLOW_INSECURE_DEV=1 and binds 127.0.0.1', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    delete process.env.MCP_HTTP_HOST;
    process.env.LOG_LEVEL = 'error';
    const logs = captureStderr();

    try {
      const server = await listen();
      expect(server.address).toBe('127.0.0.1');
      const text = logs.text();
      expect(text).toContain('SECURITY WARNING');
      expect(text).toContain('CONDUIT_S2S_SECRET is empty');
      expect(text).toContain('MCP_ALLOW_INSECURE_DEV=1');
      expect(text).toContain('127.0.0.1 only');
      expect(text).not.toContain('not a loopback address');
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it('forces 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is not loopback', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const logs = captureStderr();

    try {
      const server = await listen();
      expect(server.address).toBe('127.0.0.1');
      const text = logs.text();
      expect(text).toContain('MCP_HTTP_HOST=0.0.0.0 is not a loopback address');
      expect(text).toContain('Binding 127.0.0.1 only');
      expect(text).toContain('HTTP streaming server listening on 127.0.0.1:');
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it('forces 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is localhost', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = 'localhost';
    const logs = captureStderr();

    try {
      const server = await listen();
      expect(server.address).toBe('127.0.0.1');
      expect(logs.text()).toContain('SECURITY WARNING');
      expect(logs.text()).not.toContain('not a loopback address');
      expect(logs.text()).toContain('listening on 127.0.0.1:');
    } finally {
      logs.restore();
    }
  });

  it('honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const logs = captureStderr();

    try {
      const server = await listen();
      expect(server.address).toBe('0.0.0.0');
      const text = logs.text();
      expect(text).toContain('HTTP streaming server listening on 0.0.0.0:');
      expect(text).not.toContain('not a loopback address');
      assertNoSecrets(text);
    } finally {
      logs.restore();
    }
  });

  it('binds 127.0.0.1 when MCP_HTTP_HOST is unset and a secret is set', async () => {
    delete process.env.MCP_HTTP_HOST;
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    const logs = captureStderr();

    try {
      const server = await listen();
      expect(server.address).toBe('127.0.0.1');
      assertNoSecrets(logs.text());
    } finally {
      logs.restore();
    }
  });

  it('accepts a secret that merely contains a placeholder word', async () => {
    process.env.CONDUIT_S2S_SECRET = 'hex-secret-value-not-placeholder';
    const exit = exitSpy();

    try {
      const server = await listen();
      expect(server.address).toBe('127.0.0.1');
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });
});

describe('HTTP /mcp authentication', () => {
  beforeEach(() => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.AUTH_MODE = 'gateway';
    process.env.ALLOY_BASE_URL = ENV_BASE_URL;
    process.env.ALLOY_CLIENT_ID = ENV_CLIENT_ID;
    process.env.ALLOY_CLIENT_SECRET = ENV_CLIENT_SECRET;
  });

  it('returns 401 when the S2S header is missing or invalid and does not read credentials', async () => {
    const getCredentials = vi.spyOn(client, 'getCredentials');
    const runWithCredentials = vi.spyOn(client, 'runWithCredentials');
    const logs = captureStderr();
    const server = await listen();

    try {
      const missing = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders(gatewayCredentialHeaders),
        body: listTools,
      });
      const invalid = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders({
          ...gatewayCredentialHeaders,
          'x-gateway-s2s': mintS2sHeader('wrong-secret'),
        }),
        body: listTools,
      });

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(missing.body).toContain('X-Gateway-S2S');
      expect(invalid.body).toContain('X-Gateway-S2S');
      assertNoSecrets(missing.body);
      assertNoSecrets(invalid.body);
      assertNoSecrets(logs.text());
      expect(getCredentials).not.toHaveBeenCalled();
      expect(runWithCredentials).not.toHaveBeenCalled();
    } finally {
      logs.restore();
    }
  });

  it('returns 401 in gateway mode without credential headers and does not use env credentials', async () => {
    const getCredentials = vi.spyOn(client, 'getCredentials');
    const runWithCredentials = vi.spyOn(client, 'runWithCredentials');
    const server = await listen();

    const response = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(S2S_SECRET) }),
      body: listTools,
    });

    expect(response.status).toBe(401);
    expect(response.body).toContain('missing required gateway credential headers');
    expect(response.body).toContain('X-Alloy-Base-Url');
    expect(response.body).toContain('X-Alloy-Client-Id');
    expect(response.body).toContain('X-Alloy-Client-Secret');
    assertNoSecrets(response.body);
    expect(getCredentials).not.toHaveBeenCalled();
    expect(runWithCredentials).not.toHaveBeenCalled();
  });

  it('returns 401 when any one gateway credential header is missing or blank', async () => {
    const runWithCredentials = vi.spyOn(client, 'runWithCredentials');
    const server = await listen();
    const s2s = mintS2sHeader(S2S_SECRET);

    const partial = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        'x-gateway-s2s': s2s,
        'x-alloy-base-url': gatewayCredentialHeaders['x-alloy-base-url'],
        'x-alloy-client-id': gatewayCredentialHeaders['x-alloy-client-id'],
      }),
      body: listTools,
    });
    const blank = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        'x-gateway-s2s': s2s,
        ...gatewayCredentialHeaders,
        'x-alloy-client-secret': '   ',
      }),
      body: listTools,
    });

    expect(partial.status).toBe(401);
    expect(blank.status).toBe(401);
    expect(partial.body).toContain('X-Alloy-Client-Secret');
    assertNoSecrets(partial.body);
    assertNoSecrets(blank.body);
    expect(runWithCredentials).not.toHaveBeenCalled();
  });

  it('accepts a valid S2S header plus credential headers and scopes those credentials', async () => {
    const runWithCredentials = vi.spyOn(client, 'runWithCredentials');
    const logs = captureStderr();
    const server = await listen();

    try {
      const response = await sendHttp({
        port: server.port,
        method: 'POST',
        path: '/mcp',
        headers: mcpHeaders({
          'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
          ...gatewayCredentialHeaders,
        }),
        body: listTools,
      });

      expect(response.status).toBe(200);
      expect(response.body).toContain('alloy_list_objects');
      assertNoSecrets(response.body);
      assertNoSecrets(logs.text());
      expect(runWithCredentials).toHaveBeenCalledWith(
        {
          baseUrl: 'https://header.example',
          clientId: 'header-client-id',
          clientSecret: 'header-client-secret',
        },
        expect.any(Function),
      );
    } finally {
      logs.restore();
    }
  });

  it('verifies the HMAC with the original secret, not a lower-cased copy', async () => {
    process.env.CONDUIT_S2S_SECRET = MIXED_CASE_SECRET;
    const server = await listen();

    const response = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        'x-gateway-s2s': mintS2sHeader(MIXED_CASE_SECRET),
        ...gatewayCredentialHeaders,
      }),
      body: listTools,
    });

    expect(response.status).toBe(200);
    expect(response.body).not.toContain(MIXED_CASE_SECRET);

    const lower = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        'x-gateway-s2s': mintS2sHeader(MIXED_CASE_SECRET.toLowerCase()),
        ...gatewayCredentialHeaders,
      }),
      body: listTools,
    });
    expect(lower.status).toBe(401);
  });

  it('serves /health without authentication and without reading credentials', async () => {
    const getCredentials = vi.spyOn(client, 'getCredentials');
    const server = await listen();

    const response = await sendHttp({ port: server.port, path: '/health' });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { status?: string; mode?: string; credentials?: unknown };
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('gateway');
    expect(body.credentials).toBeUndefined();
    assertNoSecrets(response.body);
    expect(getCredentials).not.toHaveBeenCalled();
  });

  it('skips X-Gateway-S2S when the insecure-dev bypass is on and still requires gateway credentials', async () => {
    delete process.env.CONDUIT_S2S_SECRET;
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    const server = await listen();

    const open = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders(),
      body: listTools,
    });
    expect(open.status).toBe(401);
    expect(open.body).toContain('X-Alloy-Base-Url');
    expect(open.body).not.toContain('X-Gateway-S2S');

    const withCreds = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders(gatewayCredentialHeaders),
      body: listTools,
    });
    expect(withCreds.status).toBe(200);
    expect(withCreds.body).toContain('alloy_list_objects');
  });
});

describe('HTTP env mode', () => {
  it('serves /mcp with a valid S2S header and no vendor headers', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.AUTH_MODE = 'env';
    process.env.ALLOY_CLIENT_ID = ENV_CLIENT_ID;
    process.env.ALLOY_CLIENT_SECRET = ENV_CLIENT_SECRET;
    process.env.ALLOY_BASE_URL = ENV_BASE_URL;
    const runWithCredentials = vi.spyOn(client, 'runWithCredentials');
    const server = await listen();

    const response = await sendHttp({
      port: server.port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(S2S_SECRET) }),
      body: listTools,
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain('alloy_list_objects');
    assertNoSecrets(response.body);
    expect(runWithCredentials).not.toHaveBeenCalled();
  });
});
