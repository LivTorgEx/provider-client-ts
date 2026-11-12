# `@livtorgex/provider-client-ts`

Catalog-driven public WebSocket subscriptions for LivTorgEx provider APIs. The first supported feature is public trades. The client requests feature instructions from the common public catalog endpoint, tries the provider WebSocket directly, and falls back to the existing market-data proxy when direct setup or connection fails.

The client requests only the feature codes it needs. It does not download or enumerate a provider's full catalog.

## Install

```sh
pnpm add @livtorgex/provider-client-ts
```

## Subscribe to public trades

```ts
import { PublicProviderClient } from "@livtorgex/provider-client-ts";

const provider = new PublicProviderClient({
  apiBaseUrl: "https://api.livtorgex.com",
  proxyWebSocketUrl: "wss://market-data.livtorgex.com/ws",
});

const unsubscribe = provider.subscribeTrades(
  "provider-code",
  "configured-symbol-key",
  "spot",
  (trade) => console.log(trade.price),
  (status) => console.log(status.mode, status.reason),
);

// Call when the view or consumer no longer needs the stream.
unsubscribe();
```

`apiBaseUrl` is the root of the LivTorgEx public HTTP API. `provider-code` selects the provider catalog, `configured-symbol-key` is the symbol key used by the market-data proxy, and `spot` is the optional catalog instrument type used to select the matching mapping. Pass `undefined` when the catalog has a default route. `proxyWebSocketUrl` is the market-data WebSocket used as the fallback. A Node runtime without a global `WebSocket` can pass a `createWebSocket` factory.

The subscription status callback reports `connecting`, `direct`, `proxy`, and `disconnected`. When direct setup or transport fails, the client switches to the proxy and reports the reason. Proxy reconnects use exponential backoff.

## Public feature catalog endpoint

The client sends `POST /api/catalogs/{provider_code}/features` with only the requested feature selectors:

```json
{
  "features": [
    { "kind": "websocket", "code": "kline.public_trades.v1", "inst_type": "spot" }
  ]
}
```

The response contains only the requested public feature mappings and the connection instructions needed to run them. It does not include the full catalog, credentials, authentication details, signing configuration, or internal runtime policies. The API rejects features that require credentials or outbound signing data, including hashes or checksums. The client uses the proxy fallback when the API rejects a feature or direct setup fails.

The endpoint returns credential-free `wss:` connection instructions, and the client currently supports text frames. The endpoint is a common catalog route and can accept a batch of feature selectors; this client currently sends the single public trades feature.

## Package structure

- `src/types` contains the public API, catalog, mapping, trade, and WebSocket types.
- `src/api` handles HTTP catalog requests.
- `src/features` composes feature-specific subscriptions and fallback behavior.
- `src/websocket` contains direct and proxy transports.
- `src/mapping` applies catalog mapping rules.
- `src/client.ts` is the small public client facade.

## Current mapping support

The first client version executes catalog mapping rules that use source paths and static values. It reports unsupported mapping operations or routing expressions as a direct setup failure and falls back to the proxy. The client has no signing, hash, or checksum generation support.

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
```

Husky runs ESLint on staged TypeScript and JavaScript files before commits. GitHub Actions runs lint, type checking, and package compilation for pushes to `main` and pull requests.

## Security

Do not use this client for private streams or pass credentials in public feature requests. In browsers, the market-data service must validate the WebSocket handshake's `Origin` against its allowed LivTorgEx web origins; the client cannot set that header. Report vulnerabilities through the repository's GitHub Security tab.

## License

MIT. See [LICENSE](./LICENSE).
