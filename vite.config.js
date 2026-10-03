import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import surgeHandler from './api/surge.js';
import modelHandler from './api/model-surge.js';
import historyHandler from './api/typhoon-history.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'CWA_');
  if (env.CWA_API_KEY) process.env.CWA_API_KEY = env.CWA_API_KEY;
  return {
    plugins: [react(), {
      name: 'local-event-surge-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const handlers = { '/api/surge': surgeHandler, '/api/model-surge': modelHandler, '/api/typhoon-history': historyHandler };
          const handler = handlers[req.url?.split('?')[0]];
          if (!handler) return next();
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (body) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
          await handler(req, res);
        });
      },
    }],
    server: {
      proxy: {
        // Keep the existing live typhoon endpoint and other APIs unchanged.
        '/api': { target: 'https://storm-surge-predict-system.vercel.app', changeOrigin: true, secure: true },
      },
    },
  };
});
