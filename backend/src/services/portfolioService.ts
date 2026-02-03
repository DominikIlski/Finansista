import { db } from '../db/index';
import { MarketDataProvider } from '../providers/base';
import { getMarketDefinition } from '../config/markets';
import { getNameOverride } from '../config/nameOverrides';
import { getLatestQuote, getHistory } from './marketDataService';
import { resolveSymbolName } from './validationService';
import { getFxRate } from './fxService';

export type HoldingRow = {
  id: number;
  portfolio_id: number;
  ticker: string;
  market: string;
  buy_date: string;
  buy_price: number;
  quantity: number;
  created_at: string;
};

export type HoldingWithQuote = HoldingRow & {
  company_name: string | null;
  latest_quote: {
    price: number;
    currency: string | null;
    as_of: string;
    source: string;
    cached: boolean;
  };
  market_value: number;
  cost_basis: number;
  unrealized_pnl: number;
};

const normalizeDate = (date: string) => {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const createDateRange = (from: string, to: string) => {
  const dates: string[] = [];
  let current = new Date(from);
  const end = new Date(to);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
};

const listHoldings = (portfolioId: number) => {
  return db
    .prepare(
      `SELECT id, portfolio_id, ticker, market, buy_date, buy_price, quantity, created_at
       FROM holdings
       WHERE portfolio_id = ?
       ORDER BY created_at DESC`
    )
    .all(portfolioId) as HoldingRow[];
};

const getCachedSymbolName = (ticker: string, market: string) => {
  const marketDefinition = getMarketDefinition(market);
  const normalizedMarket = marketDefinition?.code.toUpperCase() ?? market.toUpperCase();
  const normalizedTicker = ticker.toUpperCase();

  const row = db
    .prepare(
      `SELECT name
       FROM market_symbols
       WHERE ticker = ? AND market = ?
       ORDER BY last_verified_at DESC
       LIMIT 1`
    )
    .get(normalizedTicker, normalizedMarket) as { name?: string | null } | undefined;

  if (row?.name) return row.name;

  const overrideName = getNameOverride(normalizedMarket, normalizedTicker);
  if (!overrideName) return null;

  db.prepare(
    `INSERT OR REPLACE INTO market_symbols
     (ticker, market, name, currency, exchange, provider, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    normalizedTicker,
    normalizedMarket,
    overrideName,
    marketDefinition?.currency ?? null,
    marketDefinition?.providerExchange ?? null,
    'OVERRIDE'
  );

  return overrideName;
};

const addHolding = ({
  portfolioId,
  ticker,
  market,
  buyDate,
  buyPrice,
  quantity
}: {
  portfolioId: number;
  ticker: string;
  market: string;
  buyDate: string;
  buyPrice: number;
  quantity: number;
}) => {
  const result = db
    .prepare(
      `INSERT INTO holdings (portfolio_id, ticker, market, buy_date, buy_price, quantity)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(portfolioId, ticker, market, buyDate, buyPrice, quantity);

  return db
    .prepare(
      `SELECT id, portfolio_id, ticker, market, buy_date, buy_price, quantity, created_at
       FROM holdings
       WHERE id = ?`
    )
    .get(result.lastInsertRowid) as HoldingRow;
};

const deleteHolding = ({ id, portfolioId }: { id: number; portfolioId: number }) => {
  const result = db.prepare(`DELETE FROM holdings WHERE id = ? AND portfolio_id = ?`).run(id, portfolioId);
  return result.changes > 0;
};

const listHoldingsWithQuotes = async ({
  portfolioId,
  providers,
  baseCurrency,
  forceRefresh = false
}: {
  portfolioId: number;
  providers: MarketDataProvider[];
  baseCurrency: string;
  forceRefresh?: boolean;
}) => {
  const holdings = listHoldings(portfolioId);
  const rateCache = new Map<string, number>();
  const normalizedBase = baseCurrency.toUpperCase();
  let nameLookupsRemaining = 6;

  const resolveRate = async (fromCurrency: string) => {
    const normalizedFrom = fromCurrency.toUpperCase();
    if (normalizedFrom === normalizedBase) return 1;
    if (rateCache.has(normalizedFrom)) return rateCache.get(normalizedFrom) as number;
    const rate = await getFxRate({ base: normalizedFrom, quote: normalizedBase, providers });
    rateCache.set(normalizedFrom, rate);
    return rate;
  };

  const enriched = await Promise.all(
    holdings.map(async (holding) => {
      const marketCurrency = getMarketDefinition(holding.market)?.currency || 'USD';
      const fxRate = await resolveRate(marketCurrency);
      let companyName = getCachedSymbolName(holding.ticker, holding.market);
      if (!companyName && nameLookupsRemaining > 0) {
        nameLookupsRemaining -= 1;
        try {
          companyName = await resolveSymbolName({
            ticker: holding.ticker,
            market: holding.market,
            providers
          });
        } catch {
          companyName = null;
        }
      }
      let quote = null as null | {
        price: number;
        currency: string | null;
        as_of: string;
        source: string;
        cached: boolean;
      };

      try {
        const latest = await getLatestQuote({
          ticker: holding.ticker,
          market: holding.market,
          providers,
          forceRefresh
        });

        quote = {
          price: latest.price * fxRate,
          currency: normalizedBase,
          as_of: latest.as_of,
          source: latest.source,
          cached: latest.cached
        };
      } catch (error) {
        quote = {
          price: holding.buy_price * fxRate,
          currency: normalizedBase,
          as_of: holding.buy_date,
          source: 'BUY_PRICE_FALLBACK',
          cached: true
        };
      }

      const marketValue = quote.price * holding.quantity;
      const costBasis = holding.buy_price * holding.quantity * fxRate;
      const unrealized = marketValue - costBasis;

      return {
        ...holding,
        company_name: companyName,
        // buy_price is converted to the base currency for display; cost_basis uses the original buy_price * fxRate.
        buy_price: holding.buy_price * fxRate,
        latest_quote: quote,
        market_value: marketValue,
        cost_basis: costBasis,
        unrealized_pnl: unrealized
      } satisfies HoldingWithQuote;
    })
  );

  return enriched;
};

const getPerformanceSeries = async ({
  portfolioId,
  from,
  to,
  providers,
  baseCurrency,
  forceRefresh = false
}: {
  portfolioId: number;
  from?: string;
  to?: string;
  providers: MarketDataProvider[];
  baseCurrency: string;
  forceRefresh?: boolean;
}) => {
  const holdings = listHoldings(portfolioId);
  if (!holdings.length) return { series: [], from, to };

  const earliestBuy = holdings.reduce((min, holding) =>
    holding.buy_date < min ? holding.buy_date : min
  , holdings[0].buy_date);

  const startDate = normalizeDate(from || earliestBuy);
  const endDate = normalizeDate(to || todayIso());
  const dates = createDateRange(startDate, endDate);

  const historyMap = new Map<number, Map<string, number>>();
  const normalizedBase = baseCurrency.toUpperCase();
  const rateCache = new Map<string, number>();

  const resolveRate = async (fromCurrency: string) => {
    const normalizedFrom = fromCurrency.toUpperCase();
    if (normalizedFrom === normalizedBase) return 1;
    if (rateCache.has(normalizedFrom)) return rateCache.get(normalizedFrom) as number;
    const rate = await getFxRate({ base: normalizedFrom, quote: normalizedBase, providers });
    rateCache.set(normalizedFrom, rate);
    return rate;
  };

  const currencies = Array.from(
    new Set(holdings.map((holding) => getMarketDefinition(holding.market)?.currency || 'USD'))
  );

  await Promise.all(currencies.map((currency) => resolveRate(currency)));

  await Promise.all(
    holdings.map(async (holding) => {
      const marketCurrency = getMarketDefinition(holding.market)?.currency || 'USD';
      const fxRate = await resolveRate(marketCurrency);
      try {
        const { rows } = await getHistory({
          ticker: holding.ticker,
          market: holding.market,
          from: startDate,
          to: endDate,
          interval: '1d',
          providers,
          forceRefresh
        });

        const priceByDate = new Map(
          rows.map((row) => [row.date, row.price * fxRate] as const)
        );
        const earliest = rows[0]?.date;
        const fallbackDate = holding.buy_date > startDate ? holding.buy_date : startDate;
        if (!earliest || earliest > fallbackDate) {
          priceByDate.set(fallbackDate, holding.buy_price * fxRate);
        }
        historyMap.set(holding.id, priceByDate);
      } catch (error) {
        const fallbackDate = holding.buy_date > startDate ? holding.buy_date : startDate;
        const priceByDate = new Map([[fallbackDate, holding.buy_price * fxRate]]);
        historyMap.set(holding.id, priceByDate);
      }
    })
  );

  const series: Array<{ date: string; value: number }> = [];
  const lastKnown = new Map<number, number>();

  for (const date of dates) {
    let total = 0;
    holdings.forEach((holding) => {
      if (date < holding.buy_date) {
        return;
      }
      const priceMap = historyMap.get(holding.id);
      if (priceMap?.has(date)) {
        lastKnown.set(holding.id, priceMap.get(date) as number);
      }
      const marketCurrency = getMarketDefinition(holding.market)?.currency || 'USD';
      const rate = rateCache.get(marketCurrency) ?? 1;
      const price = lastKnown.get(holding.id) ?? holding.buy_price * rate;
      total += price * holding.quantity;
    });

    series.push({ date, value: total });
  }

  return { series, from: startDate, to: endDate };
};

export { listHoldings, addHolding, deleteHolding, listHoldingsWithQuotes, getPerformanceSeries };
