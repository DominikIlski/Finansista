import { db } from '../db/index';
import { HistoryPoint, MarketDataProvider, ProviderError } from '../providers/base';
import { getMarketDefinition } from '../config/markets';

const getQuoteTtlSeconds = (): number => Number(process.env.QUOTE_TTL_SECONDS || 60);

const fetchWithProviders = async <T>(
  providers: MarketDataProvider[],
  task: (provider: MarketDataProvider) => Promise<T>
): Promise<{ provider: MarketDataProvider; result: T }> => {
  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      const result = await task(provider);
      return { provider, result };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new ProviderError('No providers configured');
};

const resolveExchange = (market: string) => {
  const definition = getMarketDefinition(market);
  return definition?.providerExchange || market;
};

const filterProvidersForMarket = (providers: MarketDataProvider[], market: string) => {
  const normalized = market.toUpperCase();
  const stooqMarkets = new Set(['NASDAQ', 'NYSE', 'AMEX', 'XWAR', 'GPW', 'XLON', 'XETR']);
  const preferStooq = new Set(['XWAR', 'GPW', 'XLON', 'XETR']);

  const filtered = providers.filter((provider) => {
    if (provider.name === 'STOOQ') {
      return stooqMarkets.has(normalized);
    }
    return true;
  });

  if (preferStooq.has(normalized)) {
    return [...filtered].sort((a, b) => (a.name === 'STOOQ' ? -1 : b.name === 'STOOQ' ? 1 : 0));
  }

  return filtered;
};

const getCachedQuote = (ticker: string, market: string) => {
  return db
    .prepare(
      `SELECT price, currency, as_of, source, fetched_at, expires_at
       FROM quote_cache
       WHERE ticker = ? AND market = ? AND expires_at > datetime('now')
       ORDER BY expires_at DESC
       LIMIT 1`
    )
    .get(ticker, market) as
    | {
        price: number;
        currency: string | null;
        as_of: string;
        source: string;
        fetched_at: string;
        expires_at: string;
      }
    | undefined;
};

const getStaleQuote = (ticker: string, market: string) => {
  return db
    .prepare(
      `SELECT price, currency, as_of, source, fetched_at, expires_at
       FROM quote_cache
       WHERE ticker = ? AND market = ?
       ORDER BY as_of DESC, fetched_at DESC
       LIMIT 1`
    )
    .get(ticker, market) as
    | {
        price: number;
        currency: string | null;
        as_of: string;
        source: string;
        fetched_at: string;
        expires_at: string;
      }
    | undefined;
};

const cacheQuote = ({
  ticker,
  market,
  price,
  currency,
  asOf,
  source
}: {
  ticker: string;
  market: string;
  price: number;
  currency: string | null;
  asOf: string;
  source: string;
}) => {
  const ttlSeconds = getQuoteTtlSeconds();
  db.prepare(
    `INSERT OR REPLACE INTO quote_cache
     (ticker, market, price, currency, as_of, source, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', ?))`
  ).run(ticker, market, price, currency, asOf, source, `+${ttlSeconds} seconds`);
};

const getLatestQuote = async ({
  ticker,
  market,
  providers,
  forceRefresh = false
}: {
  ticker: string;
  market: string;
  providers: MarketDataProvider[];
  forceRefresh?: boolean;
}) => {
  const cached = forceRefresh ? null : getCachedQuote(ticker, market);
  if (cached) return { ...cached, cached: true };

  const marketProviders = filterProvidersForMarket(providers, market);
  const exchange = resolveExchange(market);

  try {
    const { provider, result } = await fetchWithProviders(marketProviders, (p) =>
      p.getQuote({ ticker, market: exchange })
    );

    cacheQuote({
      ticker,
      market,
      price: result.price,
      currency: result.currency,
      asOf: result.asOf,
      source: provider.name
    });

    return {
      price: result.price,
      currency: result.currency,
      as_of: result.asOf,
      source: provider.name,
      cached: false
    };
  } catch (error) {
    const stale = getStaleQuote(ticker, market);
    if (stale) {
      return {
        price: stale.price,
        currency: stale.currency,
        as_of: stale.as_of,
        source: stale.source,
        cached: true
      };
    }
    const history = getLatestHistoryPrice(ticker, market);
    if (history) {
      return {
        price: history.price,
        currency: history.currency,
        as_of: history.as_of,
        source: history.source || 'HISTORY',
        cached: true
      };
    }
    throw error;
  }
};

const getCachedHistory = ({
  ticker,
  market,
  interval,
  from,
  to
}: {
  ticker: string;
  market: string;
  interval: string;
  from: string;
  to: string;
}) => {
  const rows = getHistoryRows({ ticker, market, interval, from, to });
  if (!rows.length) return null;

  const earliest = rows[0].date;
  const latest = rows[rows.length - 1].date;
  if (earliest <= from && latest >= to) return rows;
  return null;
};

const getHistoryRows = ({
  ticker,
  market,
  interval,
  from,
  to
}: {
  ticker: string;
  market: string;
  interval: string;
  from: string;
  to: string;
}) => {
  const rows = db
    .prepare(
      `SELECT date, price, currency
       FROM price_history
       WHERE ticker = ? AND market = ? AND interval = ? AND date BETWEEN ? AND ?
       ORDER BY date`
    )
    .all(ticker, market, interval, from, to) as Array<HistoryPoint>;

  return rows;
};

const getLatestHistoryPrice = (ticker: string, market: string) => {
  const row = db
    .prepare(
      `SELECT price, currency, date, source
       FROM price_history
       WHERE ticker = ? AND market = ? AND interval = '1d'
       ORDER BY date DESC
       LIMIT 1`
    )
    .get(ticker, market) as
    | {
        price: number;
        currency: string | null;
        date: string;
        source: string;
      }
    | undefined;

  if (!row) return null;
  return {
    price: row.price,
    currency: row.currency,
    as_of: row.date,
    source: row.source
  };
};

const cacheHistoryRows = ({
  ticker,
  market,
  interval,
  rows,
  source
}: {
  ticker: string;
  market: string;
  interval: string;
  rows: HistoryPoint[];
  source: string;
}) => {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO price_history
     (ticker, market, interval, price, currency, date, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  );

  const insertMany = db.transaction((records: HistoryPoint[]) => {
    for (const row of records) {
      stmt.run(ticker, market, interval, row.price, row.currency, row.date, source);
    }
  });

  insertMany(rows);
};

const getHistory = async ({
  ticker,
  market,
  from,
  to,
  interval,
  providers,
  forceRefresh = false
}: {
  ticker: string;
  market: string;
  from: string;
  to: string;
  interval: string;
  providers: MarketDataProvider[];
  forceRefresh?: boolean;
}) => {
  const cached = forceRefresh ? null : getCachedHistory({ ticker, market, interval, from, to });
  if (cached) return { rows: cached, source: 'CACHE' };

  const marketProviders = filterProvidersForMarket(providers, market);
  const exchange = resolveExchange(market);

  const { provider, result } = await fetchWithProviders(marketProviders, (p) =>
    p.getHistory({ ticker, market: exchange, from, to, interval })
  );

  cacheHistoryRows({
    ticker,
    market,
    interval,
    rows: result,
    source: provider.name
  });

  const rows = getCachedHistory({ ticker, market, interval, from, to }) || result;
  return { rows, source: provider.name };
};

export { getLatestQuote, getHistory, fetchWithProviders, getLatestHistoryPrice, getHistoryRows };
