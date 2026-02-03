import 'dotenv/config';
import { createApp } from './app';
import { createProviderChain } from './providers';
import { resolvedDbPath } from './db/index';

const port = Number(process.env.PORT || 4000);
const providers = createProviderChain();
const app = createApp({ providers });

app.listen(port, () => {
  console.log(`Portfolio API running on http://localhost:${port}`);
  console.log(`SQLite at ${resolvedDbPath}`);
  console.log(`Providers: ${providers.map((p) => p.name).join(', ')}`);
});
