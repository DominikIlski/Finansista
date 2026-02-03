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

const BASE_URL = 'https://api.twelvedata.com';

const mapInterval = (interval?: string) => {
  if (!interval || interval === '1d') return '1day';
  if (interval === '1h') return '1h';
  return interval;
};

const parseError = (payload: unknown) => {
  if (!payload) return 'Unknown error';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as { message?: string; error?: string }).message;
    const error = (payload as { error?: string }).error;
    return message || error || 'Unknown error';
  }
  return 'Unknown error';
};

const normalizeExchange = (market?: string | null) => {
  if (!market) return undefined;
  if (market.toUpperCase() === 'BINANCE') return 'Binance';
  return market;
};

const isCryptoRequest = (ticker: string, market?: string | null) => {
  return ticker.includes('/') || market?.toUpperCase() === 'BINANCE';
};

export class TwelveDataProvider extends MarketDataProvider {
  private apiKey?: string;

  constructor({ apiKey }: { apiKey?: string }) {
    super('TWELVE_DATA');
    this.apiKey = apiKey;
  }

  private buildUrl(path: string, params: Record<string, string | undefined>) {
    const search = new URLSearchParams({ ...params, apikey: this.apiKey || '' });
    return `${BASE_URL}/${path}?${search.toString()}`;
  }

  async searchSymbol({ ticker, market }: SymbolSearchParams): Promise<SymbolSearchResult | null> {
    if (!ticker) throw new ProviderError('Ticker is required');

    if (isCryptoRequest(ticker, market)) {
      const [base, quote] = ticker.split('/') as [string, string | undefined];
      const url = this.buildUrl('cryptocurrencies', {
        symbol: quote ? `${base}/${quote}` : undefined,
        currency_base: base || undefined,
        currency_quote: quote || undefined,
        exchange: normalizeExchange(market)
      });

      const response = await fetch(url);
      const payload = (await response.json()) as {
        status?: string;
        data?: Array<{
          symbol?: string;
          currency_base?: string;
          currency_quote?: string;
          available_exchanges?: string[];
        }>;
      };

      if (!response.ok || payload.status === 'error') {
        throw new ProviderError('Crypto search failed', parseError(payload));
      }

      const matches = Array.isArray(payload.data) ? payload.data : [];
      const normalized = quote ? `${base}/${quote}`.toUpperCase() : base.toUpperCase();
      const found = matches.find((item) => item.symbol?.toUpperCase() === normalized);
      if (!found) return null;

      return {
        ticker: found.symbol ?? normalized,
        market: (market || 'BINANCE').toUpperCase(),
        name: found.currency_base || null,
        currency: found.currency_quote || null,
        exchange: normalizeExchange(market) || null
      };
    }

    const url = this.buildUrl('symbol_search', {
      symbol: ticker,
      exchange: normalizeExchange(market)
    });

    const response = await fetch(url);
    const payload = (await response.json()) as {
      status?: string;
      data?: Array<{
        symbol?: string;
        exchange?: string;
        instrument_name?: string;
        name?: string;
        currency?: string;
      }>;
    };

    if (!response.ok || payload.status === 'error') {
      throw new ProviderError('Symbol search failed', parseError(payload));
    }

    const matches = Array.isArray(payload.data) ? payload.data : [];
    const normalizedTicker = ticker.toUpperCase();
    const normalizedMarket = market ? market.toUpperCase() : null;

    const exact = matches.find((item) => {
      const symbolMatch = item.symbol?.toUpperCase() === normalizedTicker;
      if (!symbolMatch) return false;
      if (!normalizedMarket) return true;
      return item.exchange?.toUpperCase() === normalizedMarket;
    });

    if (!exact) return null;

    return {
      ticker: exact.symbol ?? ticker,
      market: exact.exchange || market || '',
      name: exact.instrument_name || exact.name || null,
      currency: exact.currency || null,
      exchange: exact.exchange || null
    };
  }

  async getQuote({ ticker, market }: SymbolSearchParams): Promise<QuoteResult> {
    if (!ticker) throw new ProviderError('Ticker is required');
    const url = this.buildUrl('quote', {
      symbol: ticker,
      exchange: normalizeExchange(market)
    });

    const response = await fetch(url);
    const payload = (await response.json()) as {
      status?: string;
      price?: string | number;
      currency?: string;
      datetime?: string;
    };

    if (!response.ok || payload.status === 'error') {
      throw new ProviderError('Quote fetch failed', parseError(payload));
    }

    const price = Number(payload.price);
    if (!Number.isFinite(price)) {
      throw new ProviderError('Invalid price from provider', payload);
    }

    return {
      price,
      currency: payload.currency || null,
      asOf: payload.datetime || new Date().toISOString()
    };
  }

  async getHistory({ ticker, market, from, to, interval }: HistoryParams): Promise<HistoryPoint[]> {
    if (!ticker) throw new ProviderError('Ticker is required');

    const url = this.buildUrl('time_series', {
      symbol: ticker,
      exchange: normalizeExchange(market),
      interval: mapInterval(interval),
      start_date: from || undefined,
      end_date: to || undefined,
      outputsize: '5000'
    });

    const response = await fetch(url);
    const payload = (await response.json()) as {
      status?: string;
      values?: Array<{ datetime?: string; close?: string | number }>;
      meta?: { currency?: string };
    };

    if (!response.ok || payload.status === 'error') {
      throw new ProviderError('History fetch failed', parseError(payload));
    }

    const values = Array.isArray(payload.values) ? payload.values : [];

    return values
      .map((row) => ({
        date: row.datetime?.slice(0, 10),
        price: Number(row.close),
        currency: payload.meta?.currency || null
      }))
      .filter((row): row is HistoryPoint => !!row.date && Number.isFinite(row.price));
  }

  async getExchangeRate({ base, quote }: ExchangeRateParams): Promise<ExchangeRateResult> {
    const symbol = `${base}/${quote}`;
    const url = this.buildUrl('exchange_rate', { symbol });

    const response = await fetch(url);
    const payload = (await response.json()) as {
      status?: string;
      rate?: string | number;
      timestamp?: number;
    };

    if (!response.ok || payload.status === 'error') {
      throw new ProviderError('FX rate fetch failed', parseError(payload));
    }

    const rate = Number(payload.rate);
    if (!Number.isFinite(rate)) {
      throw new ProviderError('Invalid FX rate from provider', payload);
    }

    return { rate, timestamp: payload.timestamp ?? null };
  }
}
