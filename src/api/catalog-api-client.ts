import type {
  PublicFeaturesRequest,
  PublicFeaturesResponse,
  PublicWebSocketFeatureInstructions,
  WebSocketFeatureSelector,
} from "../types/catalog";

export class CatalogApiClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(apiBaseUrl: string, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.baseUrl = new URL(apiBaseUrl);
    if (this.baseUrl.protocol !== "https:" && this.baseUrl.protocol !== "http:") {
      throw new Error("apiBaseUrl must use HTTP or HTTPS");
    }
    this.fetchImpl = fetchImpl;
  }

  async getFeatures(
    providerCode: string,
    features: WebSocketFeatureSelector[],
  ): Promise<PublicWebSocketFeatureInstructions[]> {
    const url = new URL(
      `api/catalogs/${encodeURIComponent(providerCode)}/features`,
      ensureTrailingSlash(this.baseUrl),
    );
    const request: PublicFeaturesRequest = { features };
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`Public feature catalog request failed (${response.status})`);
    }

    const result = await response.json() as PublicFeaturesResponse;
    return result.features;
  }
}

function ensureTrailingSlash(url: URL): URL {
  const result = new URL(url);
  if (!result.pathname.endsWith("/")) result.pathname += "/";
  return result;
}
