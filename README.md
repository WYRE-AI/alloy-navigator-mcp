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
| `AUTH_MODE` | `env` (default, reads the vars above) or `gateway` (credentials arrive per-request via the `X-Alloy-Base-Url` / `X-Alloy-Client-Id` / `X-Alloy-Client-Secret` headers, injected by the Conduit gateway). |
| `CONDUIT_S2S_SECRET` | When set, the HTTP transport requires a valid `X-Gateway-S2S` header (Conduit sidecar auth) on every `/mcp` request. |
| `LOG_LEVEL` | `debug` \| `info` (default) \| `warn` \| `error`. |

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

```bash
docker build -t alloy-navigator-mcp .
docker run -p 8080:8080 \
  -e ALLOY_BASE_URL=https://alloy.example.com \
  -e ALLOY_CLIENT_ID=... \
  -e ALLOY_CLIENT_SECRET=... \
  alloy-navigator-mcp
```
