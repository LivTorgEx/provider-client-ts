import { CatalogApiClient } from "./api/catalog-api-client.js";
import { subscribePublicTrades } from "./features/public-trades.js";
import { createGlobalWebSocket } from "./websocket/socket.js";
import type { PublicProviderClientOptions } from "./types/client.js";
import type { PublicWebSocketFeatureInstructions, WebSocketFeatureSelector } from "./types/catalog.js";
import type { PublicTrade } from "./types/trade.js";
import type { TransportStatus, WebSocketFactory } from "./types/websocket.js";

export class PublicProviderClient {
  readonly catalogApi: CatalogApiClient;

  private readonly createWebSocket: WebSocketFactory;

  constructor(private readonly options: PublicProviderClientOptions) {
    this.catalogApi = new CatalogApiClient(options.apiBaseUrl, options.fetch);
    this.createWebSocket = options.createWebSocket ?? createGlobalWebSocket;
  }

  getFeatures(
    providerCode: string,
    features: WebSocketFeatureSelector[],
  ): Promise<PublicWebSocketFeatureInstructions[]> {
    return this.catalogApi.getFeatures(providerCode, features);
  }

  subscribeTrades(
    providerCode: string,
    symbolKey: string,
    instrumentType: string | undefined,
    onTrade: (trade: PublicTrade) => void,
    onStatus?: (status: TransportStatus) => void,
  ): () => void {
    return subscribePublicTrades({
      api: this.catalogApi,
      providerCode,
      symbolKey,
      proxyWebSocketUrl: this.options.proxyWebSocketUrl,
      createWebSocket: this.createWebSocket,
      onTrade,
      ...(instrumentType === undefined ? {} : { instrumentType }),
      ...(onStatus === undefined ? {} : { onStatus }),
    });
  }
}
