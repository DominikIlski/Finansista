import express, { Request, Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { validateSymbol } from './services/validationService';
import {
  addHolding,
  deleteHolding,
  listHoldingsWithQuotes,
  getPerformanceSeries
} from './services/portfolioService';
import { db } from './db/index';
import { MarketDataProvider } from './providers/base';
import { getSupportedMarkets } from './config/markets';

const holdingSchema = z.object({
  ticker: z.string().min(1).max(32).transform((val) => val.toUpperCase()),
  market: z.string().min(1).max(16).transform((val) => val.toUpperCase()),
  buy_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  buy_price: z.coerce.number().positive(),
  quantity: z.coerce.number().positive()
});

const idParamSchema = z.coerce.number().int().positive();

const getPortfolioBaseCurrency = (portfolioId: number) => {
  const row = db
    .prepare('SELECT base_currency FROM portfolios WHERE id = ?')
    .get(portfolioId) as { base_currency?: string } | undefined;
  return row?.base_currency || 'USD';
};

const createApp = ({ providers }: { providers: MarketDataProvider[] }) => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/exchanges', (req: Request, res: Response) => {
    res.json({ exchanges: getSupportedMarkets() });
  });

  app.get('/api/portfolios', (req: Request, res: Response) => {
    const rows = db.prepare(
      `SELECT id, name, base_currency, created_at FROM portfolios ORDER BY id`
    ).all();
    res.json({ portfolios: rows });
  });

  app.post('/api/validate', async (req: Request, res: Response) => {
    try {
      const payload = holdingSchema.pick({ ticker: true, market: true }).parse(req.body);
      const result = await validateSymbol({
        ticker: payload.ticker,
        market: payload.market,
        providers
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  });

  app.get('/api/holdings', async (req: Request, res: Response) => {
    try {
      const portfolioId = Number(req.query.portfolioId || 1);
      const currency = typeof req.query.currency === 'string'
        ? req.query.currency.toUpperCase()
        : getPortfolioBaseCurrency(portfolioId);
      const holdings = await listHoldingsWithQuotes({ portfolioId, providers, baseCurrency: currency });
      res.json({ holdings, base_currency: currency });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to fetch holdings' });
    }
  });

  app.post('/api/holdings', async (req: Request, res: Response) => {
    try {
      const payload = holdingSchema.parse(req.body);
      const portfolioId = Number(req.body.portfolioId || 1);

      const validation = await validateSymbol({
        ticker: payload.ticker,
        market: payload.market,
        providers
      });

      if (!validation.valid) {
        return res.status(400).json({
          error: 'Ticker validation failed',
          details: validation
        });
      }

      const normalizedTicker = validation.normalized?.ticker || payload.ticker;
      const normalizedMarket = validation.normalized?.market || payload.market;

      const holding = addHolding({
        portfolioId,
        ticker: normalizedTicker,
        market: normalizedMarket,
        buyDate: payload.buy_date,
        buyPrice: payload.buy_price,
        quantity: payload.quantity
      });

      res.status(201).json({ holding });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  });

  app.delete('/api/holdings/:id', (req: Request, res: Response) => {
    try {
      const id = idParamSchema.parse(req.params.id);
      const portfolioId = Number(req.query.portfolioId || 1);
      const deleted = deleteHolding({ id, portfolioId });
      if (!deleted) {
        return res.status(404).json({ error: 'Holding not found' });
      }
      res.json({ deleted: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  });

  app.get('/api/portfolio/performance', async (req: Request, res: Response) => {
    try {
      const portfolioId = Number(req.query.portfolioId || 1);
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const currency = typeof req.query.currency === 'string'
        ? req.query.currency.toUpperCase()
        : getPortfolioBaseCurrency(portfolioId);
      const result = await getPerformanceSeries({
        portfolioId,
        from,
        to,
        providers,
        baseCurrency: currency
      });
      res.json({ ...result, base_currency: currency });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to fetch performance' });
    }
  });

  return app;
};

export { createApp };
