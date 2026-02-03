type MarketNameOverrides = Record<string, Record<string, string>>;

const NAME_OVERRIDES: MarketNameOverrides = {
  XWAR: {
    ABE: 'AB S.A.',
    BFT: 'Benefit Systems S.A.',
    CBF: 'Cyber_Folks S.A.',
    CDR: 'CD Projekt S.A.',
    COG: 'Cognor Holding S.A.',
    DIG: 'Digital Network S.A.',
    ETFBS80TR: 'Beta sWIG80TR Portfelowy FIZ ETF',
    GPW: 'Gielda Papierow Wartosciowych w Warszawie S.A.',
    KGH: 'KGHM Polska Miedz S.A.',
    LPP: 'LPP S.A.',
    PAS: 'Passus S.A.',
    PEO: 'Bank Polska Kasa Opieki S.A.',
    PGE: 'PGE Polska Grupa Energetyczna S.A.',
    PKN: 'Orlen S.A.',
    PZU: 'Powszechny Zaklad Ubezpieczen S.A.',
    SNT: 'Synektik S.A.',
    XTB: 'XTB S.A.'
  },
  XETR: {
    P500: 'Invesco S&P 500 UCITS ETF',
    SPYL: 'SPDR S&P 500 UCITS ETF (Acc)',
    VUAA: 'Vanguard S&P 500 UCITS ETF (USD) Accumulating'
  },
  XLON: {
    EGLN: 'iShares Physical Gold ETC'
  }
};

const getNameOverride = (market: string, ticker: string) => {
  const marketMap = NAME_OVERRIDES[market.toUpperCase()];
  if (!marketMap) return null;
  return marketMap[ticker.toUpperCase()] || null;
};

export { NAME_OVERRIDES, getNameOverride };
