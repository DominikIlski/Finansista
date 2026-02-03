export type SymbolSearchParams = {
  ticker: string;
  market?: string | null;
};

export type SymbolSearchResult = {
  ticker: string;
  market: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
};

export type QuoteResult = {
  price: number;
  currency: string | null;
  asOf: string;
};

export type HistoryPoint = {
  date: string;
  price: number;
  currency: string | null;
};

export type ExchangeRateParams = {
  base: string;
  quote: string;
};

export type ExchangeRateResult = {
  rate: number;
  timestamp?: number | string | null;
};

export type HistoryParams = {
  ticker: string;
  market?: string | null;
  from: string | null;
  to: string | null;
  interval: string;
};

export class ProviderError extends Error {
  details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ProviderError';
    this.details = details;
  }
}

export abstract class MarketDataProvider {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract searchSymbol(params: SymbolSearchParams): Promise<SymbolSearchResult | null>;
  abstract getQuote(params: SymbolSearchParams): Promise<QuoteResult>;
  abstract getHistory(params: HistoryParams): Promise<HistoryPoint[]>;
  abstract getExchangeRate(params: ExchangeRateParams): Promise<ExchangeRateResult>;
}
