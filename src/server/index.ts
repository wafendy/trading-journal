import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createDb, migrateDb } from './db/index';
import { createRepo } from './repository';
import { buildApp } from './app';

const { db } = createDb(process.env.DB_PATH ?? './trading.db');
migrateDb(db);
const repo = createRepo(db, () => new Date().toISOString());
const app = buildApp({ repo, now: () => new Date().toISOString() });

if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('/*', serveStatic({ path: './dist/index.html' }));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => console.log(`Trading Journal on http://localhost:${info.port}`));
