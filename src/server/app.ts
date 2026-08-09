import { Hono } from 'hono';
import { registerRoutes, errorHandler, type Deps } from './routes';

export function buildApp(deps: Deps): Hono {
  const app = new Hono();
  const api = new Hono();
  registerRoutes(api, deps);
  app.route('/api', api);
  app.onError(errorHandler);
  return app;
}
