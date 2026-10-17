# Alloy Navigator MCP Server

MCP server for [Alloy Navigator](https://www.alloysoftware.com/)'s REST API - IT asset management, ITSM, and network inventory data (incidents, work orders, assets, software catalog, consumables, and more) for AI assistants and the WYRE Conduit gateway.

## Authentication

Alloy Navigator authenticates third-party applications with the OAuth2 **client_credentials** grant. An application account is registered in the Alloy Navigator Settings App under **Services > API > Applications**, which issues a **client ID** and **client secret**. This connector exchanges those for a bearer access token by `POST`ing to `<base URL>/api/token`, then sends `Authorization: Bearer <token>` on every subsequent request. Access tokens are valid for 8 hours per Alloy Navigator's own documentation; this connector caches a token per credential set and transparently re-authenticates once it's near expiry (see `src/auth.ts`).

Alloy Navigator has **no fixed hosted API endpoint** - every instance (on-premises, or a customer's own self-hosted-cloud tenant) is deployed at its own base URL, so this connector requires **all three** of a base URL, a client ID, and a client secret. In gateway mode all three arrive per-request via the `X-Alloy-Base-Url`, `X-Alloy-Client-Id`, and `X-Alloy-Client-Secret` headers; in local/stdio mode they're read once from `ALLOY_BASE_URL`, `ALLOY_CLIENT_ID`, and `ALLOY_CLIENT_SECRET`.

Alloy Navigator's API module (and this connector's application-account grant type specifically) requires the **API Module** to be installed and enabled on the target instance - see Alloy Navigator's own Installation Guide ("Installing and Configuring the API Module") if a client_credentials request returns a connection or 404 error rather than an auth error.

### Credential scope

**Vendor-documented, not independently verified against a live account** (see Verification below for why): Alloy Navigator's API User's Guide describes application accounts as accounts used by "third-party applications that run without a signed-in user present," distinct from a regular technician (username/password) account, but does not document a way to scope an application account's *read* access below whatever object classes and fields the account otherwise has permission to see in Alloy Navigator's own security/role configuration. In practice this means the actual read-only guarantee is enforced by this connector's tool surface (GET-only, no workflow-action execution), not by the credential itself - Alloy Navigator's own workflow-action model means even a technically "read" API call executes through the same account whose role could, in principle, also be granted write/workflow-action permissions elsewhere. Customers should create a **dedicated, minimally-privileged application account** for this connector, matching the same practice recommended by other vendors in this fleet (e.g. PRTG) whose API keys inherit the creating account's full permission set.

### Verification

This connector was built directly against Alloy Navigator's official API User's Guide (`docs.alloysoftware.com/alloynavigator/docs/api-userguide/`), not against secondary documentation or a naming convention - every tool below maps to one real, documented GET operation, with its exact query parameters and response shape verified against the guide's own worked examples (see each tool's JSDoc in `src/client.ts` for the source example it was checked against). What it is **not** is independently verified against a live Alloy Navigator instance: Alloy Navigator does not publish a public self-serve trial or sandbox instance, and provisioning one requires a live sales/licensing engagement this build environment could not complete. This is a build-environment limitation, not a vendor-side approval gate for a customer with an existing license.

## Configuration

| Env var | Description |
|---|---|
| `ALLOY_BASE_URL` | Base URL of the Alloy Navigator server, e.g. `https://alloy.example.com`. |
| `ALLOY_CLIENT_ID` | Application account client ID, issued under Settings App > Services > API > Applications. |
| `ALLOY_CLIENT_SECRET` | Application account client secret, issued alongside the client ID. |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `AUTH_MODE` | `env` (default, reads the vars above) or `gateway` (credentials arrive per-request via the `X-Alloy-Base-Url` / `X-Alloy-Client-Id` / `X-Alloy-Client-Secret` headers, injected by the Conduit gateway). The Docker image and Compose file default to `gateway`. In gateway mode, `/mcp` returns 401 when any of those headers is missing and never falls back to `ALLOY_*`. |
| `CONDUIT_S2S_SECRET` | Required for HTTP. Service-to-service secret. The HTTP server logs an error and exits non-zero when this is empty or a known placeholder (`changeme`, `secret`, `placeholder`, `your-s2s-secret`, `replace-with-a-real-secret`, and the same list in `src/http.ts`). Compose will not start when it is unset. Never commit a real value. The process never logs it. |
| `MCP_ALLOW_INSECURE_DEV` | Set to exactly `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning, skips `X-Gateway-S2S`, and listens on `127.0.0.1` only. A wider `MCP_HTTP_HOST` is overridden. A known placeholder secret is still refused. |
| `MCP_HTTP_HOST` | Bind address when `MCP_TRANSPORT=http`. Defaults to `127.0.0.1`. A configured `CONDUIT_S2S_SECRET` honors this value, including `0.0.0.0`. The container image sets `0.0.0.0`. Without a secret, the listener is `127.0.0.1` only. |
| `MCP_HTTP_PORT` | HTTP port. Defaults to `8080`. |
| `LOG_LEVEL` | `debug` \| `info` (default) \| `warn` \| `error`. |

`/health` stays unauthenticated and does not read credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

### HTTP authentication

With `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` set, every `/mcp` request must include `X-Gateway-S2S`. A missing or invalid header returns 401 before any vendor credential is read.

The header is an HMAC proof, not a copy of the secret:

```text
t=<unix seconds>,v1=<hex hmac-sha256>
```

`<hex hmac-sha256>` is HMAC-SHA256 of the ASCII string `t=<unix seconds>` (the same `t=` prefix and the same decimal timestamp), keyed with `CONDUIT_S2S_SECRET`, encoded as lowercase hex. The timestamp must be within 300 seconds of the server clock.

```js
import { createHmac } from 'node:crypto';

const secret = process.env.CONDUIT_S2S_SECRET;
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac('sha256', secret).update(`t=${t}`).digest('hex');
const xGatewayS2s = `t=${t},v1=${v1}`;
```

In `AUTH_MODE=gateway`, `/mcp` also requires `X-Alloy-Base-Url`, `X-Alloy-Client-Id`, and `X-Alloy-Client-Secret`. Those headers are the only credential source for that request.

```js
await fetch('http://127.0.0.1:8080/mcp', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'x-gateway-s2s': xGatewayS2s,
    'x-alloy-base-url': 'https://alloy.example.com',
    'x-alloy-client-id': 'application-client-id',
    'x-alloy-client-secret': 'application-client-secret',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
```

## Tools

Alloy Navigator's API is class-generic rather than one fixed REST path per object type (unlike, say, PRTG's `/devices`, `/sensors`, etc.) - a single object class parameter (`Incidents`, `Computers`, `Work Orders`, `Consumables`, `SoftwareCatalog`, `Purchase Order Items`, and so on) selects what you're querying. This connector's 4 tools mirror that shape faithfully rather than inventing per-class tools Alloy Navigator's own API doesn't have.

### Objects
- `alloy_list_objects` - list/search objects of a given object class, with field selection, sorting, paging, free-text search, and per-field filters.
- `alloy_get_object` - get every field of a single object by its OID (ticket number) or database record GUID.

### Activities
- `alloy_get_object_activities` - get the activity/history log entries recorded against a single object (status changes, assignment changes, system notes).

### Dictionary
- `alloy_get_dictionary` - get the allowed reference/classification values (e.g. valid `Status` or `Types` values) for a field on an object class.

## Scope

**This is a deliberately narrow, read-only v1 surface: 4 `GET` operations covering exactly Alloy Navigator's generic object query, single-object read, activity/history read, and reference-value lookup - nothing else.** Alloy Navigator's API User's Guide documents a significantly larger surface built around **workflow actions** (Alloy Navigator does not create or update objects directly; every mutation runs as a named workflow action against an object). This connector excludes every one of those by design, not by oversight:

**Hard-excluded (object creation and mutation - all mutation in Alloy Navigator's API model runs through workflow actions) - never implemented:** `POST /object/<oid>/action/<actionId>` - executing a workflow action (the mechanism Alloy Navigator's own "Creating objects" documentation describes for creating new incidents, work orders, assets, and any other object) is a write by definition and is excluded outright, including any workflow action a customer's instance might label as innocuous-sounding (e.g. an "Acknowledge" or "Close" action) - this connector has no way to distinguish a read-flavored action from a real state-changing one, so none are exposed.

**Hard-excluded (redundant POST-based retrieval) - never implemented:** Alloy Navigator's guide documents POST variants of both the object-list and object-activities GET endpoints (`POST /<objectClass>`, `POST /Activities/<oid>`), intended to work around URL query-length limits when a caller constructs a raw URL by hand. This connector builds every request server-side from structured tool arguments rather than a hand-typed URL, so the length limit the POST variant exists to work around doesn't apply here - implementing it would add a second code path with identical behavior and no read/write distinction of its own, so it's excluded as redundant rather than as a scope boundary.

**Hard-excluded (user/session/application administration - identity and credential management, not ITSM/asset data) - never implemented:** the technician (username/password) authentication grant (`POST /api/token` with `grant_type=password`) - this connector only uses the application-account `client_credentials` grant, the shape intended for unattended service integrations - and any endpoint for managing application accounts, technician accounts, or sessions themselves.

**Hard-excluded (out of ITSM/asset-data scope) - never implemented:** `GET /api/v2/GetAppConfig` - configuration for a registered mobile scanner application (Settings App > Services > Mobile Applications), unrelated to IT asset/ITSM record data and dependent on a customer having registered a mobile app in the first place.

They can be added as a follow-up if there's demand, after a deliberate scope decision - not by default.

## Development

```bash
npm install
npm run build
npm test
npm run lint   # tsc --noEmit
```

## Docker

The image listens on `0.0.0.0` inside the container (`MCP_HTTP_HOST`) and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass the S2S secret. In gateway mode, Alloy Navigator credentials arrive on each request as `X-Alloy-*` headers; the image does not read them from the environment.

```bash
docker build -t alloy-navigator-mcp .
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -p 127.0.0.1:8080:8080 \
  alloy-navigator-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset, sets `AUTH_MODE=gateway`, publishes `127.0.0.1:8080:8080`, and passes no `ALLOY_*` variables:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `ALLOY_BASE_URL`, `ALLOY_CLIENT_ID`, and `ALLOY_CLIENT_SECRET`:

```bash
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e AUTH_MODE=env \
  -e ALLOY_BASE_URL=https://alloy.example.com \
  -e ALLOY_CLIENT_ID=your-client-id \
  -e ALLOY_CLIENT_SECRET=your-client-secret \
  -p 127.0.0.1:8080:8080 \
  alloy-navigator-mcp
```

Local HTTP without a secret is development-only. It binds `127.0.0.1` and logs a warning. A non-loopback `MCP_HTTP_HOST` is overridden to `127.0.0.1`:

```bash
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 npm run start:http
```
