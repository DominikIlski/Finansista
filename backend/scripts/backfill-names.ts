import { db } from '../src/db/index';
import { createProviderChain } from '../src/providers';
import { validateSymbol } from '../src/services/validationService';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

const providers = createProviderChain();

const run = async () => {
  const holdings = db
    .prepare(
      `SELECT DISTINCT ticker, market
       FROM holdings
       ORDER BY ticker`
    )
    .all() as Array<{ ticker: string; market: string }>;

  let processed = 0;
  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  for (const holding of holdings) {
    if (limit !== null && processed >= limit) break;
    processed += 1;

    const cached = db
      .prepare(
        `SELECT name
         FROM market_symbols
         WHERE ticker = ? AND market = ?
         ORDER BY last_verified_at DESC
         LIMIT 1`
      )
      .get(holding.ticker, holding.market) as { name?: string | null } | undefined;

    if (cached?.name) {
      skipped += 1;
      continue;
    }

    try {
      if (dryRun) {
        enriched += 1;
        continue;
      }
      const result = await validateSymbol({
        ticker: holding.ticker,
        market: holding.market,
        providers
      });

      if (result.valid && result.symbol?.name) {
        enriched += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors += 1;
    }
  }

  console.log('Backfill summary:', { processed, enriched, skipped, errors });
  if (dryRun) {
    console.log('Dry run enabled. No names were persisted.');
  }
};

run();
