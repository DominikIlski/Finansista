import { MarketDataProvider } from './base';
import { TwelveDataProvider } from './twelveData';
import { StooqProvider } from './stooq';

export const createProviderChain = (): MarketDataProvider[] => {
  const primaryName = (process.env.PROVIDER || 'TWELVE_DATA').toUpperCase();
  const providers: MarketDataProvider[] = [];

  if (primaryName === 'TWELVE_DATA') {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (apiKey) {
      providers.push(new TwelveDataProvider({ apiKey }));
    }
  }

  if (primaryName === 'STOOQ') {
    providers.push(new StooqProvider());
  }

  // Always include Stooq as last-resort fallback.
  providers.push(new StooqProvider());

  // Deduplicate by provider name.
  const unique: MarketDataProvider[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    if (!seen.has(provider.name)) {
      seen.add(provider.name);
      unique.push(provider);
    }
  }

  return unique;
};
