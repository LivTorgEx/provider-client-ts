import type { CatalogApiClient } from "../api/catalog-api-client.js";
import type { WebSocketFeatureSelector } from "../types/catalog.js";
import type { JsonValue } from "../types/json.js";
import type { PublicTrade } from "../types/trade.js";
import type { TransportStatus, WebSocketFactory } from "../types/websocket.js";
import { connectDirectFeature } from "../websocket/direct-feature.js";
import { connectProxyTrades } from "../websocket/proxy-trades.js";

export const PUBLIC_TRADES_FEATURE = "kline.public_trades.v1";

export type PublicTradesOptions = {
  api: CatalogApiClient;
  providerCode: string;
  symbolKey: string;
  instrumentType?: string;
  proxyWebSocketUrl: string;
  createWebSocket: WebSocketFactory;
  onTrade: (trade: PublicTrade) => void;
  onStatus?: (status: TransportStatus) => void;
};

export function subscribePublicTrades(options: PublicTradesOptions): () => void {
  let stopped = false;
  let usingProxy = false;
  let stopDirect: (() => void) | undefined;
  let stopProxy: (() => void) | undefined;

  const report = (mode: TransportStatus["mode"], reason?: string) => {
    options.onStatus?.(reason === undefined ? { mode } : { mode, reason });
  };

  const connectProxy = (reason: string) => {
    if (stopped || usingProxy) return;
    usingProxy = true;
    stopDirect?.();
    stopDirect = undefined;
    report("proxy", reason);
    stopProxy = connectProxyTrades({
      proxyUrl: options.proxyWebSocketUrl,
      symbolKey: options.symbolKey,
      createWebSocket: options.createWebSocket,
      onTrade: options.onTrade,
      onStatus: (status) => options.onStatus?.(status),
    });
  };

  const startDirect = async () => {
    report("connecting");
    try {
      const selector: WebSocketFeatureSelector = options.instrumentType === undefined
        ? { kind: "websocket", code: PUBLIC_TRADES_FEATURE }
        : {
            kind: "websocket",
            code: PUBLIC_TRADES_FEATURE,
            inst_type: options.instrumentType,
          };
      const [instructions] = await options.api.getFeatures(options.providerCode, [selector]);
      if (stopped || usingProxy) return;
      if (!instructions) throw new Error("Public trades feature was not resolved");

      const input: JsonValue = { symbol_key: options.symbolKey };
      stopDirect = connectDirectFeature({
        instructions,
        requestedFeatureCode: PUBLIC_TRADES_FEATURE,
        providerCode: options.providerCode,
        input,
        createWebSocket: options.createWebSocket,
        onTrade: options.onTrade,
        onOpen: () => report("direct"),
        onFailure: connectProxy,
      });
    } catch (error) {
      connectProxy(errorMessage(error));
    }
  };

  void startDirect();

  return () => {
    if (stopped) return;
    stopped = true;
    stopDirect?.();
    stopProxy?.();
    report("disconnected");
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown WebSocket failure";
}
