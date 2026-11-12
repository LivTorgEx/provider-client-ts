import type { WebSocketFactory } from "../types/websocket.js";

export const createGlobalWebSocket: WebSocketFactory = (url) => {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("No WebSocket implementation is available; provide createWebSocket");
  }
  return new globalThis.WebSocket(url);
};
