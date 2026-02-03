import { db } from '../db/index';
import { MarketDataProvider, ProviderError } from '../providers/base';
import { getMarketDefinition, getSupportedMarkets } from '../config/markets';

const getValidationTtlDays = (): number => Number(process.env.VALIDATION_TTL_DAYS || 7);

const getCachedValidation = ({ ticker, market }: { ticker: string; market: string }) => {
  const row = db
    .prepare(
      `SELECT ticker, market, name, currency, exchange, provider, last_verified_at
       FROM market_symbols
       WHERE ticker = ? AND market = ?
       ORDER BY last_verified_at DESC
       LIMIT 1`
    )
    .get(ticker, market) as
    | {
        ticker: string;
        market: string;
        name: string | null;
        currency: string | null;
        exchange: string | null;
        provider: string;
        last_verified_at: string;
      }
    | undefined;

  if (!row) return null;
  const ttlDays = getValidationTtlDays();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ttlDays);
  if (new Date(row.last_verified_at) < cutoff) return null;
  return row;
};

const cacheValidation = ({
  ticker,
  market,
  name,
  currency,
  exchange,
  provider
}: {
  ticker: string;
  market: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  provider: string;
}) => {
  const existing = db
    .prepare(
      `SELECT name
       FROM market_symbols
       WHERE ticker = ? AND market = ?
       ORDER BY last_verified_at DESC
       LIMIT 1`
    )
    .get(ticker, market) as { name?: string | null } | undefined;

  const nameToStore = existing?.name ?? name;

  db.prepare(
    `INSERT OR REPLACE INTO market_symbols
     (ticker, market, name, currency, exchange, provider, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(ticker, market, nameToStore, currency, exchange, provider);
};

const normalizeTicker = (ticker: string, market: string) => {
  const marketDefinition = getMarketDefinition(market);
  if (marketDefinition?.assetType === 'crypto') {
    if (!ticker.includes('/')) {
      const quote = marketDefinition.defaultQuote || 'USD';
      return `${ticker}/${quote}`;
    }
  }
  return ticker;
};

const orderProvidersForMarket = (providers: MarketDataProvider[], market: string) => {
  const normalized = market.toUpperCase();
  const preferStooq = new Set(['XWAR', 'GPW', 'XLON', 'XETR']);
  if (!preferStooq.has(normalized)) return providers;
  return [...providers].sort((a, b) => (a.name === 'STOOQ' ? -1 : b.name === 'STOOQ' ? 1 : 0));
};

const orderProvidersForNames = (providers: MarketDataProvider[]) => {
  return [...providers].sort((a, b) => {
    if (a.name === 'TWELVE_DATA') return -1;
    if (b.name === 'TWELVE_DATA') return 1;
    if (a.name === 'STOOQ') return 1;
    if (b.name === 'STOOQ') return -1;
    return 0;
  });
};

const validateSymbol = async ({
  ticker,
  market,
  providers
}: {
  ticker: string;
  market: string;
  providers: MarketDataProvider[];
}) => {
  const marketDefinition = getMarketDefinition(market);
  if (!marketDefinition) {
    return {
      valid: false,
      source: 'LOCAL',
      reason: 'unsupported_market',
      supported_markets: getSupportedMarkets()
    };
  }

  const normalizedMarket = marketDefinition.code.toUpperCase();
  const normalizedTicker = normalizeTicker(ticker.toUpperCase(), normalizedMarket);

  const cached = getCachedValidation({ ticker: normalizedTicker, market: normalizedMarket });
  if (cached) return { valid: true, source: 'CACHE', symbol: cached };

  const orderedProviders = orderProvidersForMarket(providers, normalizedMarket);
  let lastProvider = 'UNKNOWN';
  for (const provider of orderedProviders) {
    lastProvider = provider.name;
    try {
      const result = await provider.searchSymbol({
        ticker: normalizedTicker,
        market: marketDefinition.providerExchange
      });

      if (!result) continue;

      cacheValidation({
        ticker: result.ticker.toUpperCase(),
        market: normalizedMarket,
        name: result.name,
        currency: result.currency,
        exchange: result.exchange,
        provider: provider.name
      });

      return {
        valid: true,
        source: provider.name,
        symbol: { ...result, ticker: result.ticker.toUpperCase(), market: normalizedMarket },
        normalized: { ticker: normalizedTicker, market: normalizedMarket }
      };
    } catch (error) {
      if (error instanceof ProviderError) continue;
      throw error;
    }
  }

  return {
    valid: false,
    source: lastProvider,
    reason: 'not_found',
    normalized: { ticker: normalizedTicker, market: normalizedMarket }
  };
};

const resolveSymbolName = async ({
  ticker,
  market,
  providers
}: {
  ticker: string;
  market: string;
  providers: MarketDataProvider[];
}) => {
  const marketDefinition = getMarketDefinition(market);
  if (!marketDefinition) return null;

  const normalizedMarket = marketDefinition.code.toUpperCase();
  const normalizedTicker = normalizeTicker(ticker.toUpperCase(), normalizedMarket);

  const cached = getCachedValidation({ ticker: normalizedTicker, market: normalizedMarket });
  if (cached?.name) return cached.name;

  const orderedProviders = orderProvidersForNames(providers);
  for (const provider of orderedProviders) {
    try {
      const result = await provider.searchSymbol({
        ticker: normalizedTicker,
        market: marketDefinition.providerExchange
      });

      if (!result?.name) continue;

      cacheValidation({
        ticker: result.ticker.toUpperCase(),
        market: normalizedMarket,
        name: result.name,
        currency: result.currency,
        exchange: result.exchange,
        provider: provider.name
      });

      return result.name;
    } catch (error) {
      if (error instanceof ProviderError) continue;
      throw error;
    }
  }

  return null;
};

export { validateSymbol, resolveSymbolName };
