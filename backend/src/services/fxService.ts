import { db } from '../db/index';
import { MarketDataProvider } from '../providers/base';
import { FrankfurterProvider } from '../providers/frankfurter';
import { fetchWithProviders } from './marketDataService';

const getFxTtlSeconds = (): number => Number(process.env.FX_TTL_SECONDS || 3600);

const getCachedFxRate = (base: string, quote: string) => {
  return db
    .prepare(
      `SELECT rate, source
       FROM fx_rates
       WHERE base = ? AND quote = ? AND expires_at > datetime('now')
       ORDER BY expires_at DESC
       LIMIT 1`
    )
    .get(base, quote) as { rate: number; source: string } | undefined;
};

const getStaleFxRate = (base: string, quote: string) => {
  return db
    .prepare(
      `SELECT rate, source
       FROM fx_rates
       WHERE base = ? AND quote = ?
       ORDER BY fetched_at DESC
       LIMIT 1`
    )
    .get(base, quote) as { rate: number; source: string } | undefined;
};

const cacheFxRate = ({ base, quote, rate, source }: { base: string; quote: string; rate: number; source: string }) => {
  const ttlSeconds = getFxTtlSeconds();
  db.prepare(
    `INSERT OR REPLACE INTO fx_rates
     (base, quote, rate, source, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now', ?))`
  ).run(base, quote, rate, source, `+${ttlSeconds} seconds`);
};

const getFxRate = async ({
  base,
  quote,
  providers
}: {
  base: string;
  quote: string;
  providers: MarketDataProvider[];
}) => {
  if (base === quote) return 1;

  const cached = getCachedFxRate(base, quote);
  if (cached) return cached.rate;

  const fxProviders: MarketDataProvider[] = [
    ...providers.filter((p) => p.name !== 'STOOQ'),
    new FrankfurterProvider()
  ];

  try {
    const { provider, result } = await fetchWithProviders(fxProviders, (p) =>
      p.getExchangeRate({ base, quote })
    );

    cacheFxRate({ base, quote, rate: result.rate, source: provider.name });
    return result.rate;
  } catch (error) {
    const stale = getStaleFxRate(base, quote);
    if (stale) return stale.rate;
    throw error;
  }
};

export { getFxRate };
