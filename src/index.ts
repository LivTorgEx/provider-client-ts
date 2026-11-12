export { CatalogApiClient } from "./api/catalog-api-client.js";
export { PublicProviderClient } from "./client.js";
export { PUBLIC_TRADES_FEATURE, subscribePublicTrades } from "./features/public-trades.js";
export { applyMapping, assertMappingSupported } from "./mapping/index.js";
export type { MappingContext } from "./mapping/index.js";
export type {
  FeatureLifecycleOperation,
  FeatureOperation,
  MappingContextRequest,
  MappingDocument,
  MappingRule,
  PublicFeaturesRequest,
  PublicFeaturesResponse,
  PublicProviderClientOptions,
  PublicTrade,
  PublicTradeProxyMessage,
  PublicWebSocketFeatureInstructions,
  JsonValue,
  TransportMode,
  TransportStatus,
  WebSocketFeatureSelector,
  WebSocketFactory,
  WebSocketLike,
  WebSocketOperation,
  WebSocketStep,
} from "./types/index.js";
