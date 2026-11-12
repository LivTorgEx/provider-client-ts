export type PublicTrade = {
  symbol_key: string;
  trade_id: string;
  price: number;
  quantity: number;
  trade_time: number;
  was_buyer_maker: boolean;
};

export type PublicTradeProxyMessage = PublicTrade & {
  event: "Trade";
};
