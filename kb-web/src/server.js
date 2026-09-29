import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { buildTree } from './kb-index.js';
import { search } from './search.js';
import { readArticle } from './article.js';
import { resolveAuth, describeAuth } from './ai/auth.js';
import { saveSettings } from './config.js';
import { ask } from './ai/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(here, '..', 'web');

export function createServer() {
  const app = Fastify({ logger: false });
  let tree = null;

  app.get('/api/tree', async () => {
    if (!tree) tree = buildTree();
    return tree;
  });

  app.get('/api/search', async (req, reply) => {
    const { q, limit } = req.query;
    if (!q) return reply.code(400).send({ error: 'q is required' });
    return { hits: search(q, { limit: Number(limit) || 50 }) };
  });

  app.get('/api/article', async (req, reply) => {
    const { path: rel, start, end } = req.query;
    try {
      return readArticle(rel, start, end);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/ai/status', async () => describeAuth(resolveAuth()));

  app.post('/api/ai/settings', async (req, reply) => {
    const { apiKey, baseUrl } = req.body ?? {};
    if (!apiKey || !baseUrl) {
      return reply.code(400).send({ error: 'apiKey 与 baseUrl 必须成对提供' });
    }
    saveSettings({ apiKey, baseUrl });
    return { configured: true, source: 'settings' };
  });

  app.post('/api/ask', async (req, reply) => {
    const { question, context } = req.body ?? {};
    if (!question) return reply.code(400).send({ error: 'question is required' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (ev) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    try {
      for await (const ev of ask({ question, context }, { signal: req.raw.signal })) {
        send(ev);
      }
    } catch (err) {
      send({ type: 'error', message: err.message });
    }
    reply.raw.end();
  });

  app.register(import('@fastify/static'), { root: WEB_DIR, prefix: '/' });
  return app;
}

// 仅在直接运行时启动；被 import 时不监听端口，方便测试 inject
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createServer();
  app.listen({ host: '127.0.0.1', port: Number(process.env.PORT) || 5173 })
    .then(() => console.log('http://127.0.0.1:5173'))
    .catch((err) => { console.error(err); process.exit(1); });
}
