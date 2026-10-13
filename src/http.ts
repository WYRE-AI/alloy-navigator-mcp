import { createServer as createHttpServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { runWithCredentials } from './client.js';
import type { AlloyCredentials } from './types.js';
import { logger } from './utils/logger.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';

/**
 * HTTP transport fails closed (CWE-306).
 *
 * An empty CONDUIT_S2S_SECRET used to skip X-Gateway-S2S and leave /mcp
 * open. Startup now refuses to listen unless the secret is a real value.
 * Known placeholders are rejected even when MCP_ALLOW_INSECURE_DEV=1, so a
 * copied example cannot become the HMAC key. That flag is local development
 * only: it skips the header check and listens on 127.0.0.1.
 *
 * The secret is read here, at startup, not at module load, and is never logged.
 */

const LOOPBACK_HOST = '127.0.0.1';

/** Public example values. Exact match after trim and lower-casing. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-real-secret',
  'your-s2s-secret',
  'your-secret',
  'changeme',
  'change-me',
  'placeholder',
  'secret',
  'example',
  'replace-me',
  's2s-secret',
]);

const MISSING_S2S_SECRET_ERROR =
  'Refusing to start HTTP server: CONDUIT_S2S_SECRET is empty. ' +
  'Set CONDUIT_S2S_SECRET to the gateway-provisioned secret (openssl rand -hex 32), or set MCP_ALLOW_INSECURE_DEV=1 for local development only.';

const PLACEHOLDER_S2S_SECRET_ERROR =
  'Refusing to start HTTP server: CONDUIT_S2S_SECRET is a known placeholder. ' +
  'Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value.';

const INSECURE_DEV_WARNING =
  'SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. ' +
  'The HTTP server is starting WITHOUT service-to-service authentication and listens on 127.0.0.1 only. ' +
  'Do not use MCP_ALLOW_INSECURE_DEV outside local development.';

const S2S_UNAUTHORIZED = {
  error: 'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
};

const GATEWAY_CREDENTIALS_UNAUTHORIZED = {
  error:
    'Unauthorized: missing required gateway credential headers X-Alloy-Base-Url, X-Alloy-Client-Id, and X-Alloy-Client-Secret.',
};

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, '$1');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

interface HttpListenConfig {
  s2sSecret: string;
  host: string;
}

/**
 * Fail closed on an empty or placeholder secret. MCP_ALLOW_INSECURE_DEV=1
 * bypasses only an empty secret, and that bypass always binds 127.0.0.1.
 * A configured secret honors MCP_HTTP_HOST, defaulting to 127.0.0.1.
 */
function resolveHttpListen(): HttpListenConfig {
  const raw = (process.env.CONDUIT_S2S_SECRET ?? '').trim();
  if (KNOWN_PLACEHOLDER_SECRETS.has(raw.toLowerCase())) {
    logger.error(PLACEHOLDER_S2S_SECRET_ERROR);
    process.exit(1);
  }

  const configuredHost = (process.env.MCP_HTTP_HOST ?? '').trim();

  if (!raw) {
    if (process.env.MCP_ALLOW_INSECURE_DEV === '1') {
      if (configuredHost && !isLoopbackHost(configuredHost)) {
        logger.error(
          `WARNING: MCP_HTTP_HOST=${configuredHost} is not a loopback address. ` +
            'MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. ' +
            `Binding ${LOOPBACK_HOST} only.`,
        );
      }
      // error level so LOG_LEVEL=warn|error cannot hide the bypass.
      logger.error(INSECURE_DEV_WARNING);
      return { s2sSecret: '', host: LOOPBACK_HOST };
    }

    logger.error(MISSING_S2S_SECRET_ERROR);
    process.exit(1);
  }

  return {
    s2sSecret: raw,
    host: configuredHost || LOOPBACK_HOST,
  };
}

export async function startHttpServer(): Promise<Server> {
  const { s2sSecret, host } = resolveHttpListen();
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      // /health is container LIVENESS, not credential-readiness. It stays
      // unauthenticated and must not read vendor credentials: gateway mode
      // has none at process scope, and reporting env credentials would
      // disclose whether static secrets are configured.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          transport: 'http',
          mode: isGatewayMode ? 'gateway' : 'standalone',
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
      return;
    }

    // Conduit service-to-service auth (gateway#377 parity): rejected
    // BEFORE any credential extraction. An empty secret only reaches this
    // point when MCP_ALLOW_INSECURE_DEV=1, in which case there is nothing
    // to verify. A configured secret is always enforced.
    if (s2sSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2sSecret)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(S2S_UNAUTHORIZED));
      return;
    }

    const handle = async () => {
      // SECURITY-CRITICAL invariant: this transport MUST stay stateless
      // (sessionIdGenerator: undefined + enableJsonResponse: true).
      // Per-request tenant credentials are carried in an AsyncLocalStorage
      // context opened by runWithCredentials() below. A stateless
      // request->single-response flow keeps the tool call inside that
      // context - switching to a stateful/SSE transport would let a
      // long-lived connection serve later messages under a stale/foreign
      // credential context.
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    };

    if (isGatewayMode) {
      // Credentials must arrive on every request. Falling through would
      // resolve ALLOY_* from the process environment, which is not
      // request-scoped.
      const baseUrl = headerValue(req.headers['x-alloy-base-url']);
      const clientId = headerValue(req.headers['x-alloy-client-id']);
      const clientSecret = headerValue(req.headers['x-alloy-client-secret']);
      if (!baseUrl || !clientId || !clientSecret) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(GATEWAY_CREDENTIALS_UNAUTHORIZED));
        return;
      }
      const credentials: AlloyCredentials = { baseUrl, clientId, clientSecret };
      await runWithCredentials(credentials, handle);
      return;
    }

    await handle();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(port, host, () => {
      httpServer.off('error', onError);
      logger.info(`HTTP streaming server listening on ${host}:${port}`);
      resolve();
    });
  });

  return httpServer;
}

const transport = process.env.MCP_TRANSPORT;
// Vitest imports this module to call startHttpServer. Skip the CLI
// entrypoint there. `node dist/http.js` still starts HTTP or stdio.
if (process.env.VITEST !== 'true') {
  if (transport === 'http') {
    startHttpServer().catch((error) => {
      logger.error('Fatal startup error', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
  } else {
    import('./index.js');
  }
}
