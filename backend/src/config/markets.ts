export type MarketRegion = 'US' | 'UK' | 'EU' | 'CRYPTO';
export type AssetType = 'equity' | 'crypto';

export type MarketDefinition = {
  code: string;
  label: string;
  region: MarketRegion;
  assetType: AssetType;
  providerExchange: string;
  currency: string;
  defaultQuote?: string;
  aliases?: string[];
  notes?: string;
};

export const SUPPORTED_MARKETS: MarketDefinition[] = [
  {
    code: 'NASDAQ',
    label: 'NASDAQ (US)',
    region: 'US',
    assetType: 'equity',
    providerExchange: 'NASDAQ',
    currency: 'USD'
  },
  {
    code: 'NYSE',
    label: 'NYSE (US)',
    region: 'US',
    assetType: 'equity',
    providerExchange: 'NYSE',
    currency: 'USD'
  },
  {
    code: 'AMEX',
    label: 'NYSE American (AMEX)',
    region: 'US',
    assetType: 'equity',
    providerExchange: 'AMEX',
    currency: 'USD'
  },
  {
    code: 'XLON',
    label: 'London Stock Exchange (XLON)',
    region: 'UK',
    assetType: 'equity',
    providerExchange: 'XLON',
    currency: 'GBP',
    aliases: ['LSE']
  },
  {
    code: 'XWAR',
    label: 'Warsaw Stock Exchange (XWAR/GPW)',
    region: 'EU',
    assetType: 'equity',
    providerExchange: 'XWAR',
    currency: 'PLN',
    aliases: ['GPW']
  },
  {
    code: 'XETR',
    label: 'XETRA (Germany)',
    region: 'EU',
    assetType: 'equity',
    providerExchange: 'XETR',
    currency: 'EUR'
  },
  {
    code: 'XPAR',
    label: 'Euronext Paris (XPAR)',
    region: 'EU',
    assetType: 'equity',
    providerExchange: 'XPAR',
    currency: 'EUR'
  },
  {
    code: 'XAMS',
    label: 'Euronext Amsterdam (XAMS)',
    region: 'EU',
    assetType: 'equity',
    providerExchange: 'XAMS',
    currency: 'EUR'
  },
  {
    code: 'XBRU',
    label: 'Euronext Brussels (XBRU)',
    region: 'EU',
    assetType: 'equity',
    providerExchange: 'XBRU',
    currency: 'EUR'
  },
  {
    code: 'XMIL',
    label: 'Euronext Milan (XMIL)',
    region: 'EU',
    assetType: 'equity',
    providerExchange: 'XMIL',
    currency: 'EUR'
  },
  {
    code: 'XMAD',
    label: 'Bolsa de Madrid (XMAD)',
    region: 'EU',
    assetType: 'equity',
    providerExchange: 'XMAD',
    currency: 'EUR'
  },
  {
    code: 'XLIS',
    label: 'Euronext Lisbon (XLIS)',
    region: 'EU',
    assetType: 'equity',
    providerExchange: 'XLIS',
    currency: 'EUR'
  },
  {
    code: 'BINANCE',
    label: 'Binance (Crypto)',
    region: 'CRYPTO',
    assetType: 'crypto',
    providerExchange: 'Binance',
    currency: 'USD',
    defaultQuote: 'USDT',
    notes: 'Use pairs like BTC/USDT; BTC will default to BTC/USDT.'
  }
];

const marketIndex = new Map<string, MarketDefinition>();

for (const market of SUPPORTED_MARKETS) {
  marketIndex.set(market.code.toUpperCase(), market);
  market.aliases?.forEach((alias) => marketIndex.set(alias.toUpperCase(), market));
}

export const getMarketDefinition = (marketCode: string) => {
  return marketIndex.get(marketCode.toUpperCase());
};

export const getSupportedMarkets = () => SUPPORTED_MARKETS;
