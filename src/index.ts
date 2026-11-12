export { CatalogApiClient } from "./api/catalog-api-client";
export { PublicProviderClient } from "./client";
export { PUBLIC_TRADES_FEATURE, subscribePublicTrades } from "./features/public-trades";
export { applyMapping, assertMappingSupported } from "./mapping";
export type { MappingContext } from "./mapping";
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
} from "./types/index";
