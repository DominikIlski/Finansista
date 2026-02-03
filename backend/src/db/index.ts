import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(__dirname, 'schema.sql');

const resolvedDbPath = (() => {
  const configured = process.env.DATABASE_PATH || '../data/portfolio.db';
  if (configured === ':memory:') return configured;
  const absolute = path.isAbsolute(configured)
    ? configured
    : path.resolve(backendRoot, configured);
  return absolute;
})();

const ensureDirectory = (dbFilePath: string) => {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

if (resolvedDbPath !== ':memory:') {
  ensureDirectory(resolvedDbPath);
}

const db = new Database(resolvedDbPath);

db.pragma('journal_mode = WAL');

db.exec(fs.readFileSync(schemaPath, 'utf-8'));

const ensureDefaultPortfolio = () => {
  const row = db.prepare('SELECT id FROM portfolios ORDER BY id LIMIT 1').get() as
    | { id: number }
    | undefined;
  if (!row) {
    db.prepare(
      'INSERT INTO portfolios (name, base_currency) VALUES (?, ?)'
    ).run('Main', 'USD');
  }
};

ensureDefaultPortfolio();

export { db, resolvedDbPath };
