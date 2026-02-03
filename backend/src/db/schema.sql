PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  market TEXT NOT NULL,
  buy_date TEXT NOT NULL,
  buy_price REAL NOT NULL,
  quantity REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS holdings_portfolio_idx ON holdings (portfolio_id);
CREATE INDEX IF NOT EXISTS holdings_ticker_market_idx ON holdings (ticker, market);

CREATE TABLE IF NOT EXISTS market_symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  market TEXT NOT NULL,
  name TEXT,
  currency TEXT,
  exchange TEXT,
  provider TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  UNIQUE (ticker, market, provider)
);

CREATE INDEX IF NOT EXISTS market_symbols_lookup_idx ON market_symbols (ticker, market);

CREATE TABLE IF NOT EXISTS quote_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  market TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT,
  as_of TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (ticker, market, source, as_of)
);

CREATE INDEX IF NOT EXISTS quote_cache_lookup_idx ON quote_cache (ticker, market, expires_at);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  market TEXT NOT NULL,
  interval TEXT NOT NULL DEFAULT '1d',
  price REAL NOT NULL,
  currency TEXT,
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (ticker, market, source, interval, date)
);

CREATE INDEX IF NOT EXISTS price_history_lookup_idx ON price_history (ticker, market, interval, date);

CREATE TABLE IF NOT EXISTS fx_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (base, quote, source)
);

CREATE INDEX IF NOT EXISTS fx_rates_lookup_idx ON fx_rates (base, quote, expires_at);
