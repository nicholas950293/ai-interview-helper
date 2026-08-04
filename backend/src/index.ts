import { serve } from '@hono/node-server';
import { getEnv } from './lib/env.js';
import { createApp } from './app.js';

const env = getEnv();
const app = createApp();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[bff] listening on http://localhost:${info.port} (${env.NODE_ENV})`);
});
