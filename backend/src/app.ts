import { Hono } from 'hono';
import { toErrorResponse } from './lib/errors.js';
import { sessionRoutes } from './routes/session.js';
import { answerRoutes } from './routes/answers.js';
import { testRoutes } from './routes/tests.js';
import { chatRoutes } from './routes/chat.js';
import { timeRoutes } from './routes/time.js';
import { submitRoutes } from './routes/submit.js';
import { eventRoutes } from './routes/events.js';

/**
 * BFF 應用組裝點。
 * 抽成獨立函式是為了讓契約測試可以直接 `createApp().request(...)`，不需啟動真實伺服器。
 */
export function createApp() {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.route('/api', sessionRoutes);
  app.route('/api', answerRoutes);
  app.route('/api', testRoutes);
  app.route('/api', chatRoutes);
  app.route('/api', timeRoutes);
  app.route('/api', submitRoutes);
  app.route('/api', eventRoutes);

  // 全域錯誤映射（contracts/http-api.md「錯誤格式（全端點共用）」）
  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err);
    if (status === 500) {
      console.error('[bff] unhandled error', err);
    }
    return c.json(body, status);
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
