import {
  ExchangeRateParams,
  ExchangeRateResult,
  HistoryParams,
  HistoryPoint,
  MarketDataProvider,
  ProviderError,
  QuoteResult,
  SymbolSearchParams,
  SymbolSearchResult
} from './base';

const BASE_URL = 'https://api.frankfurter.dev/v1';

export class FrankfurterProvider extends MarketDataProvider {
  constructor() {
    super('FRANKFURTER');
  }

  async searchSymbol(_params: SymbolSearchParams): Promise<SymbolSearchResult | null> {
    throw new ProviderError('Frankfurter only supports FX rates');
  }

  async getQuote(_params: SymbolSearchParams): Promise<QuoteResult> {
    throw new ProviderError('Frankfurter only supports FX rates');
  }

  async getHistory(_params: HistoryParams): Promise<HistoryPoint[]> {
    throw new ProviderError('Frankfurter only supports FX rates');
  }

  async getExchangeRate({ base, quote }: ExchangeRateParams): Promise<ExchangeRateResult> {
    const url = `${BASE_URL}/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`;
    const response = await fetch(url);
    const payload = (await response.json()) as {
      rates?: Record<string, number>;
      date?: string;
    };

    if (!response.ok || !payload?.rates) {
      throw new ProviderError('FX rate fetch failed', payload);
    }

    const rate = Number(payload.rates[quote]);
    if (!Number.isFinite(rate)) {
      throw new ProviderError('Invalid FX rate from provider', payload);
    }

    return { rate, timestamp: payload.date ?? null };
  }
}
