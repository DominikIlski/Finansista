import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { MarketDataProvider } from '../src/providers/base';

process.env.DATABASE_PATH = ':memory:';
process.env.QUOTE_TTL_SECONDS = '3600';
process.env.VALIDATION_TTL_DAYS = '7';

const { createApp } = await import('../src/app');
const { db } = await import('../src/db/index');

const resetDb = () => {
  db.exec('DELETE FROM holdings');
  db.exec('DELETE FROM quote_cache');
  db.exec('DELETE FROM price_history');
  db.exec('DELETE FROM market_symbols');
  const row = db.prepare('SELECT id FROM portfolios ORDER BY id LIMIT 1').get() as
    | { id: number }
    | undefined;
  if (!row) {
    db.prepare('INSERT INTO portfolios (name, base_currency) VALUES (?, ?)').run('Main', 'USD');
  }
};

const createMockProvider = (
  overrides: Partial<MarketDataProvider> = {}
): MarketDataProvider =>
  ({
    name: 'MOCK',
    searchSymbol: async () => null,
    getQuote: async () => ({ price: 100, currency: 'USD', asOf: '2024-01-02' }),
    getHistory: async () => ([
      { date: '2024-01-01', price: 90, currency: 'USD' },
      { date: '2024-01-02', price: 100, currency: 'USD' }
    ]),
    ...overrides
  }) as MarketDataProvider;

beforeEach(() => {
  resetDb();
});

describe('portfolio API', () => {
  it('should reject holding when ticker validation fails', async () => {
    const app = createApp({ providers: [createMockProvider()] });
    const response = await request(app)
      .post('/api/holdings')
      .send({
        ticker: 'FAKE',
        market: 'NASDAQ',
        buy_date: '2024-01-01',
        buy_price: 10,
        quantity: 1
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Ticker validation failed');
  });

  it('should create holding and return it when validation passes', async () => {
    const app = createApp({
      providers: [
        createMockProvider({
          searchSymbol: async () => ({
            ticker: 'AAPL',
            market: 'NASDAQ',
            name: 'Apple',
            currency: 'USD',
            exchange: 'NASDAQ'
          })
        })
      ]
    });

    const createResponse = await request(app)
      .post('/api/holdings')
      .send({
        ticker: 'AAPL',
        market: 'NASDAQ',
        buy_date: '2024-01-01',
        buy_price: 120,
        quantity: 2
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.holding.ticker).toBe('AAPL');

    const listResponse = await request(app).get('/api/holdings');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.holdings.length).toBe(1);
    expect(listResponse.body.holdings[0].latest_quote.price).toBe(100);
  });

  it('should return cached quote when TTL not expired', async () => {
    const provider = createMockProvider({
      searchSymbol: async () => ({
        ticker: 'MSFT',
        market: 'NASDAQ',
        name: 'Microsoft',
        currency: 'USD',
        exchange: 'NASDAQ'
      })
    });

    const app = createApp({ providers: [provider] });

    await request(app)
      .post('/api/holdings')
      .send({
        ticker: 'MSFT',
        market: 'NASDAQ',
        buy_date: '2024-01-01',
        buy_price: 200,
        quantity: 1
      });

    const first = await request(app).get('/api/holdings');
    const second = await request(app).get('/api/holdings');

    expect(first.body.holdings[0].latest_quote.cached).toBe(false);
    expect(second.body.holdings[0].latest_quote.cached).toBe(true);
  });

  it('should compute portfolio performance timeseries from cached history', async () => {
    const provider = createMockProvider({
      searchSymbol: async () => ({
        ticker: 'TSLA',
        market: 'NASDAQ',
        name: 'Tesla',
        currency: 'USD',
        exchange: 'NASDAQ'
      })
    });

    const app = createApp({ providers: [provider] });

    await request(app)
      .post('/api/holdings')
      .send({
        ticker: 'TSLA',
        market: 'NASDAQ',
        buy_date: '2024-01-01',
        buy_price: 100,
        quantity: 2
      });

    const response = await request(app)
      .get('/api/portfolio/performance?from=2024-01-01&to=2024-01-02');

    expect(response.status).toBe(200);
    expect(response.body.series.length).toBe(2);
    expect(response.body.series[0].value).toBe(180);
    expect(response.body.series[1].value).toBe(200);
  });
});
