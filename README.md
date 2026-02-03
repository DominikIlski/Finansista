# Finansista – Portfolio Tracker MVP

## System Architecture Overview
- Frontend: React + Vite app (`/frontend`) for holdings entry, charting, and portfolio metrics.
- Backend: Node.js + Express API in TypeScript (`/backend`) for validation, data aggregation, and caching.
- Database: SQLite for holdings, validation cache, latest quotes, and price history.
- Market Data: Provider abstraction with a primary provider and fallback provider. Cached results stored in SQLite.

Data flow:
- UI submits a holding → API validates ticker + market → API stores holding → API fetches/returns cached quote.
- UI requests performance → API loads holdings → API fetches cached history → API computes daily portfolio values.

## Database Schema (Multi-Portfolio Ready)
Tables:
- `portfolios`: `id`, `name`, `base_currency`, `created_at`
- `holdings`: `id`, `portfolio_id`, `ticker`, `market`, `buy_date`, `buy_price`, `quantity`, `created_at`
- `market_symbols`: `ticker`, `market`, `name`, `currency`, `exchange`, `provider`, `last_verified_at`
- `quote_cache`: `ticker`, `market`, `price`, `currency`, `as_of`, `source`, `fetched_at`, `expires_at`
- `price_history`: `ticker`, `market`, `interval`, `price`, `currency`, `date`, `source`, `fetched_at`

Key indexes:
- `holdings_portfolio_idx` on `holdings(portfolio_id)`
- `holdings_ticker_market_idx` on `holdings(ticker, market)`
- `market_symbols_lookup_idx` on `market_symbols(ticker, market)`
- `quote_cache_lookup_idx` on `quote_cache(ticker, market, expires_at)`
- `price_history_lookup_idx` on `price_history(ticker, market, interval, date)`

Scaling to multi-portfolio:
- `holdings.portfolio_id` already supports multiple portfolios. Add CRUD for portfolios and pass `portfolioId` in requests.
- Quote and history caches are shared across portfolios to minimize provider calls.

## API Routes
Base URL: `http://localhost:4000`

`GET /api/exchanges`
Response:
```json
{
  "exchanges": [
    { "code": "NASDAQ", "label": "NASDAQ (US)", "assetType": "equity" },
    { "code": "XLON", "label": "London Stock Exchange (XLON)", "assetType": "equity" },
    { "code": "BINANCE", "label": "Binance (Crypto)", "assetType": "crypto" }
  ]
}
```

`GET /api/health`
Response:
```json
{ "status": "ok" }
```

`POST /api/validate`
Request:
```json
{ "ticker": "AAPL", "market": "NASDAQ" }
```
Response:
```json
{ "valid": true, "source": "TWELVE_DATA", "symbol": { "ticker": "AAPL", "market": "NASDAQ" } }
```

`GET /api/holdings`
Response:
```json
{
  "holdings": [
    {
      "id": 1,
      "ticker": "AAPL",
      "market": "NASDAQ",
      "company_name": "Apple Inc.",
      "buy_price": 120,
      "quantity": 2,
      "latest_quote": { "price": 185.1, "as_of": "2024-01-02", "source": "TWELVE_DATA", "cached": true },
      "market_value": 370.2,
      "unrealized_pnl": 130.2
    }
  ]
}
```

`POST /api/holdings`
Request:
```json
{
  "ticker": "AAPL",
  "market": "NASDAQ",
  "buy_date": "2024-01-01",
  "buy_price": 120,
  "quantity": 2
}
```
Response:
```json
{ "holding": { "id": 1, "ticker": "AAPL", "market": "NASDAQ" } }
```

`DELETE /api/holdings/:id`
Response:
```json
{ "deleted": true }
```

`GET /api/portfolio/performance?from=2024-01-01&to=2024-02-01`
Response:
```json
{
  "from": "2024-01-01",
  "to": "2024-02-01",
  "series": [
    { "date": "2024-01-01", "value": 10000 },
    { "date": "2024-01-02", "value": 10120 }
  ]
}
```

`POST /api/refresh`
Request:
```json
{ "from": "2024-01-01", "to": "2024-02-01", "currency": "PLN" }
```
Response:
```json
{ "refreshed": true }
```

## Validation Logic (Ticker + Market)
- Check `market_symbols` cache for a recent validation entry.
- If missing/expired, call provider `searchSymbol` with `ticker` and `market` (exchange).
- If found, cache the result for `VALIDATION_TTL_DAYS` and allow holding creation.
- If not found, return `400` with validation error.

## Supported Markets (MVP)
Focused on US, London, EU, plus Binance for BTC:
- US: `NASDAQ`, `NYSE`, `AMEX`
- UK: `XLON` (London Stock Exchange)
- EU: `XETR`, `XPAR`, `XAMS`, `XBRU`, `XMIL`, `XMAD`, `XLIS`
- Crypto: `BINANCE` (use `BTC/USDT`, or `BTC` which defaults to `BTC/USDT`)

## Charting Approach
- Uses Chart.js via `react-chartjs-2`.
- API returns daily series; frontend renders a smooth line with filled area.
- Missing dates are handled server-side by carrying forward last known prices per holding.
- Currency selector lets you switch base currency (PLN/USD/EUR/GBP) using cached FX rates.

## Provider Strategy
- Primary: Twelve Data (global coverage, real-time/near real-time where supported). Also used for company names.
- Fallback: Stooq (free daily prices for US/UK/PL/DE equities).
- Provider chain is configured in `backend/src/providers/index.ts` and used by caching services.

If you prefer `yfinance`, swap in a provider that scrapes Yahoo Finance data. See "Provider Tradeoffs" below.

## Provider Tradeoffs (Summary)
- Twelve Data: strong global coverage and multiple asset classes, but API key required and rate limits on free tiers.
- Stooq: free and keyless, but daily-only; best for US/UK/PL/DE equities.
- yfinance: unofficial scraping library, inconsistent real-time behavior, and subject to throttling/changes.

## Step-by-Step Local Setup
Prerequisites: Node.js 18+ (for built-in `fetch`).

1. Backend:
   - `cd backend`
   - `npm install`
   - `cp .env.example .env` and set `TWELVE_DATA_API_KEY`
   - Note: `.env` files are gitignored to avoid publishing secrets.
   - `npm run dev`
   - Optional type check: `npm run typecheck`
2. Frontend:
   - `cd frontend`
   - `npm install`
   - `cp .env.example .env` and adjust `VITE_API_URL` if needed
   - `npm run dev`
3. Open `http://localhost:5173` in the browser.

Optional:
- Set `VITE_API_URL` in `frontend/.env` if the backend runs on another host/port.
- QA smoke test (Playwright):
  - `cd frontend`
  - `npm run test:e2e -- --headed`

## Docker (Dev)
Prerequisites: Docker Desktop or Docker Engine with Compose.

1. Export your Twelve Data API key (or create a `.env` file in repo root):
   - `export TWELVE_DATA_API_KEY=your_key_here`
2. Build and start:
   - `docker compose up --build`
3. Open:
   - Frontend: `http://localhost:5173`
   - Backend health: `http://localhost:4000/api/health`

## Import XLSX Holdings
Use the provided script to import open positions from the `OPEN POSITION` sheet in account exports.

```bash
cd backend
npm install
npx tsx scripts/import-xlsx.ts --dry-run
npx tsx scripts/import-xlsx.ts
```

Options:
- `--portfolio=1` (default: 1)
- `--dir=.` (default: repo root)
