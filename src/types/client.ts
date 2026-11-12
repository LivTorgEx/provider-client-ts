import type { WebSocketFactory } from "./websocket.js";

export type PublicProviderClientOptions = {
  /** Root URL of the LivTorgEx public HTTP API, for example https://api.livtorgex.com. */
  apiBaseUrl: string;
  /** Market-data fallback WebSocket URL, for example wss://market-data.livtorgex.com/ws. */
  proxyWebSocketUrl: string;
  /** Fetch implementation for tests, browsers, or runtimes without global fetch. */
  fetch?: typeof fetch;
  /** WebSocket factory for runtimes without a global WebSocket implementation. */
  createWebSocket?: WebSocketFactory;
};
