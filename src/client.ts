import { CatalogApiClient } from "./api/catalog-api-client";
import { subscribePublicTrades } from "./features/public-trades";
import { createGlobalWebSocket } from "./websocket/socket";
import type { PublicProviderClientOptions } from "./types/client";
import type { PublicWebSocketFeatureInstructions, WebSocketFeatureSelector } from "./types/catalog";
import type { PublicTrade } from "./types/trade";
import type { TransportStatus, WebSocketFactory } from "./types/websocket";

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
