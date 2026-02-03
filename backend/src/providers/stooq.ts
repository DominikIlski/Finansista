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

const BASE_URL = 'https://stooq.com/q/d/l/';

const resolveMarketConfig = (market?: string | null) => {
  if (!market) return null;
  const normalized = market.toUpperCase();
  if (['US', 'NYSE', 'NASDAQ', 'AMEX'].includes(normalized)) {
    return { suffix: 'us', currency: 'USD', useSuffix: true };
  }
  if (['XWAR', 'GPW'].includes(normalized)) {
    return { suffix: '', currency: 'PLN', useSuffix: false };
  }
  if (['XLON', 'LSE'].includes(normalized)) {
    return { suffix: 'uk', currency: 'GBP', useSuffix: true };
  }
  if (['XETR', 'XETRA'].includes(normalized)) {
    return { suffix: 'de', currency: 'EUR', useSuffix: true };
  }
  return null;
};

const parseCsv = (text: string) => {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [] as Array<Record<string, string>>;
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return headers.reduce<Record<string, string>>((acc, key, index) => {
      acc[key.trim()] = values[index]?.trim() ?? '';
      return acc;
    }, {});
  });
};

export class StooqProvider extends MarketDataProvider {
  constructor() {
    super('STOOQ');
  }

  async searchSymbol({ ticker, market }: SymbolSearchParams): Promise<SymbolSearchResult | null> {
    const config = resolveMarketConfig(market);
    if (!config) return null;
    try {
      const history = await this.getHistory({ ticker, market, from: null, to: null, interval: '1d' });
      if (!history.length) return null;
      return {
        ticker: ticker.toUpperCase(),
        market: (market || '').toUpperCase(),
        name: null,
        currency: config.currency,
        exchange: (market || '').toUpperCase()
      };
    } catch {
      return null;
    }
  }

  async getQuote({ ticker, market }: SymbolSearchParams): Promise<QuoteResult> {
    const history = await this.getHistory({ ticker, market, from: null, to: null, interval: '1d' });
    if (!history.length) {
      throw new ProviderError('Stooq quote unavailable');
    }
    const latest = history[history.length - 1];
    return {
      price: latest.price,
      currency: latest.currency || 'USD',
      asOf: latest.date
    };
  }

  async getHistory({ ticker, market }: HistoryParams): Promise<HistoryPoint[]> {
    const config = resolveMarketConfig(market);
    if (!config) {
      throw new ProviderError('Stooq only supports US/UK/Poland/Germany equities');
    }
    if (!ticker) throw new ProviderError('Ticker is required');

    const symbol = config.useSuffix
      ? `${ticker}.${config.suffix}`.toLowerCase()
      : ticker.toLowerCase();
    const url = `${BASE_URL}?s=${symbol}&i=d`;

    const response = await fetch(url);
    const text = await response.text();

    if (!response.ok || !text) {
      throw new ProviderError('Stooq history fetch failed');
    }
    if (text.includes('Exceeded the daily hits limit')) {
      throw new ProviderError('Stooq rate limit exceeded');
    }

    const rows = parseCsv(text);
    if (!rows.length) {
      throw new ProviderError('Stooq history returned no data');
    }

    return rows
      .map((row) => ({
        date: row.Date,
        price: Number(row.Close),
        currency: config.currency
      }))
      .filter((row): row is HistoryPoint => !!row.date && Number.isFinite(row.price));
  }

  async getExchangeRate(_params: ExchangeRateParams): Promise<ExchangeRateResult> {
    throw new ProviderError('Stooq FX not supported');
  }
}
