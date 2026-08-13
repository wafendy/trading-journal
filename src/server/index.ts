import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createDb, migrateDb } from './db/index';
import { createRepo } from './repository';
import { buildApp } from './app';
import { createFinnhubProvider } from './earnings';
import { createFinnhubQuoteProvider } from './quotes';
import { createScreenshotStore } from './screenshots';

const { db } = createDb(process.env.DB_PATH ?? './trading.db');
migrateDb(db);
const repo = createRepo(db, () => new Date().toISOString());
const getNextEarnings = createFinnhubProvider({ apiKey: process.env.FINNHUB_API_KEY });
const getQuote = createFinnhubQuoteProvider({ apiKey: process.env.FINNHUB_API_KEY });
const screenshots = createScreenshotStore(process.env.SCREENSHOTS_DIR ?? './screenshots');
const app = buildApp({ repo, now: () => new Date().toISOString(), getNextEarnings, getQuote, screenshots });

if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('/*', serveStatic({ path: './dist/index.html' }));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => console.log(`Trading Journal on http://localhost:${info.port}`));
