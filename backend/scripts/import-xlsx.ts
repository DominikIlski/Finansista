import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { db } from '../src/db/index';
import { getMarketDefinition } from '../src/config/markets';

type ImportRow = {
  ticker: string;
  market: string;
  buy_date: string;
  buy_price: number;
  quantity: number;
  market_price?: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const portfolioArg = args.find((arg) => arg.startsWith('--portfolio='));
const dirArg = args.find((arg) => arg.startsWith('--dir='));

const portfolioId = portfolioArg ? Number(portfolioArg.split('=')[1]) : 1;
const searchDir = dirArg ? path.resolve(repoRoot, dirArg.split('=')[1]) : repoRoot;

const formatDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return null;
};

const extractReportDate = (filePath: string) => {
  const base = path.basename(filePath);
  const match = base.match(/_(\d{4}-\d{2}-\d{2})\.xlsx$/);
  if (match) return match[1];
  const fallback = new Date().toISOString().slice(0, 10);
  return fallback;
};

const parseSymbol = (symbol: string) => {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('.');
  if (parts.length === 1) {
    return { ticker: trimmed.toUpperCase(), market: 'NASDAQ' };
  }
  const suffix = parts.pop()!.toUpperCase();
  const base = parts.join('.').toUpperCase();

  if (suffix === 'PL') return { ticker: base, market: 'XWAR' };
  if (suffix === 'UK') return { ticker: base, market: 'XLON' };
  if (suffix === 'DE') return { ticker: base, market: 'XETR' };
  if (suffix === 'US') return { ticker: base, market: 'NASDAQ' };

  return { ticker: base, market: suffix };
};

const buildKey = (row: ImportRow) =>
  `${row.ticker}|${row.market}|${row.buy_date}|${row.buy_price}|${row.quantity}`;

const findHeaderIndex = (rows: unknown[][]) =>
  rows.findIndex((row) => Array.isArray(row) && row[0] === 'Position');

const collectRowsFromSheet = (
  rows: unknown[][],
  tracking: { skipped: number; unsupported: Set<string> }
) => {
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) return [] as ImportRow[];

  const header = rows[headerIndex] as string[];
  const symbolIdx = header.indexOf('Symbol');
  const volumeIdx = header.indexOf('Volume');
  const openTimeIdx = header.indexOf('Open time');
  const openPriceIdx = header.indexOf('Open price');
  const marketPriceIdx = header.indexOf('Market price');
  const typeIdx = header.indexOf('Type');

  if (symbolIdx < 0 || volumeIdx < 0 || openTimeIdx < 0 || openPriceIdx < 0) {
    return [] as ImportRow[];
  }

  const results: ImportRow[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;
    const symbol = row[symbolIdx];
    if (!symbol || typeof symbol !== 'string') {
      tracking.skipped += 1;
      continue;
    }

    const type = typeIdx >= 0 ? row[typeIdx] : 'BUY';
    if (type && typeof type === 'string' && type.toUpperCase() !== 'BUY') {
      tracking.skipped += 1;
      continue;
    }

    const parsed = parseSymbol(symbol);
    if (!parsed) {
      tracking.skipped += 1;
      continue;
    }

    const marketDefinition = getMarketDefinition(parsed.market);
    if (!marketDefinition) {
      tracking.unsupported.add(parsed.market);
      tracking.skipped += 1;
      continue;
    }

    const buyDate = formatDate(row[openTimeIdx]);
    const buyPrice = Number(row[openPriceIdx]);
    const marketPrice =
      marketPriceIdx >= 0 && Number.isFinite(Number(row[marketPriceIdx]))
        ? Number(row[marketPriceIdx])
        : undefined;
    const quantity = Number(row[volumeIdx]);

    if (!buyDate || !Number.isFinite(buyPrice) || !Number.isFinite(quantity)) {
      tracking.skipped += 1;
      continue;
    }

    results.push({
      ticker: parsed.ticker,
      market: marketDefinition.code,
      buy_date: buyDate,
      buy_price: buyPrice,
      quantity,
      market_price: marketPrice
    });
  }

  return results;
};

const listFiles = () => {
  const entries = fs.readdirSync(searchDir);
  return entries
    .filter((file) => file.toLowerCase().endsWith('.xlsx'))
    .map((file) => path.join(searchDir, file));
};

const existing = db
  .prepare(
    `SELECT ticker, market, buy_date, buy_price, quantity
     FROM holdings
     WHERE portfolio_id = ?`
  )
  .all(portfolioId) as ImportRow[];

const existingKeys = new Set(existing.map(buildKey));

const insertStmt = db.prepare(
  `INSERT INTO holdings (portfolio_id, ticker, market, buy_date, buy_price, quantity)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const quoteStmt = db.prepare(
  `INSERT OR REPLACE INTO quote_cache
   (ticker, market, price, currency, as_of, source, fetched_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+365 days'))`
);

const files = listFiles();
const summary = {
  files: files.length,
  inserted: 0,
  duplicates: 0,
  skipped: 0
};
const tracking = { skipped: 0, unsupported: new Set<string>() };

for (const file of files) {
  const reportDate = extractReportDate(file);
  const workbook = xlsx.readFile(file, { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => name.startsWith('OPEN POSITION'));
  if (!sheetName) continue;

  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
  const holdings = collectRowsFromSheet(rows, tracking);

  for (const row of holdings) {
    const key = buildKey(row);
    if (!dryRun && Number.isFinite(row.market_price)) {
      const marketDefinition = getMarketDefinition(row.market);
      quoteStmt.run(
        row.ticker,
        row.market,
        row.market_price,
        marketDefinition?.currency || null,
        reportDate,
        'IMPORT'
      );
    }
    if (existingKeys.has(key)) {
      summary.duplicates += 1;
      continue;
    }

    if (!dryRun) {
      insertStmt.run(portfolioId, row.ticker, row.market, row.buy_date, row.buy_price, row.quantity);
    }

    existingKeys.add(key);
    summary.inserted += 1;
  }
}

summary.skipped += tracking.skipped;
console.log('Import summary:', summary);
if (tracking.unsupported.size) {
  console.log('Unsupported market codes:', Array.from(tracking.unsupported));
}
if (dryRun) {
  console.log('Dry run enabled. No rows were inserted.');
}
