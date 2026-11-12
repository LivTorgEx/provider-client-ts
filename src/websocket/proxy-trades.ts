import type { PublicTrade, PublicTradeProxyMessage } from "../types/trade.js";
import type { TransportStatus, WebSocketFactory, WebSocketLike } from "../types/websocket.js";

export type ProxyTradesOptions = {
  proxyUrl: string;
  symbolKey: string;
  createWebSocket: WebSocketFactory;
  onTrade: (trade: PublicTrade) => void;
  onStatus: (status: TransportStatus) => void;
};

export function connectProxyTrades(options: ProxyTradesOptions): () => void {
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let socket: WebSocketLike | undefined;

  const scheduleReconnect = (reason: string) => {
    if (stopped) return;
    options.onStatus({ mode: "disconnected", reason });
    const delay = Math.min(1_000 * 2 ** reconnectAttempt, 30_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    if (stopped) return;
    try {
      const current = options.createWebSocket(options.proxyUrl);
      socket = current;
      current.onopen = () => {
        if (stopped || socket !== current) return;
        reconnectAttempt = 0;
        options.onStatus({ mode: "proxy" });
        current.send(JSON.stringify({
          event: "Subscribe",
          param: { event: "Trade", symbol_key: options.symbolKey },
        }));
      };
      current.onmessage = (event) => {
        if (stopped || typeof event.data !== "string") return;
        let message: PublicTradeProxyMessage;
        try {
          message = JSON.parse(event.data) as PublicTradeProxyMessage;
        } catch {
          return;
        }
        if (message.event !== "Trade" || message.symbol_key !== options.symbolKey) return;
        options.onTrade(message);
      };
      current.onerror = () => current.close();
      current.onclose = () => {
        if (socket === current) socket = undefined;
        scheduleReconnect("Proxy WebSocket closed; reconnecting");
      };
    } catch (error) {
      scheduleReconnect(errorMessage(error));
    }
  };

  connect();

  return () => {
    if (stopped) return;
    stopped = true;
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    const current = socket;
    socket = undefined;
    if (!current) return;
    if (current.readyState === 1) {
      current.send(JSON.stringify({
        event: "UnSubscribe",
        param: { event: "Trade", symbol_key: options.symbolKey },
      }));
    }
    current.close();
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown WebSocket failure";
}
