import { createServer } from 'node:http';
import { STATUS_CODES } from 'node:http';
import { Readable } from 'node:stream';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { D1Database } from './d1.mjs';
import { makeRuntimeEnv } from './runtime-env.mjs';
import {
  MemoryDurableObjectNamespace,
  WebSocketPair,
  WorkerWebSocket,
  installWorkerResponseCompatibility
} from './runtime.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 3088;
const HEALTH_PATHS = new Set(['/healthz', '/health']);
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_WEBSOCKET_PAYLOAD_BYTES = 64 * 1024;
const WORKER_ALLOWED_ORIGIN = 'https://gomoku-home.pages.dev';
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'
]);

function safeErrorName(error) {
  const name = String(error?.name || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  return name || 'Error';
}

const roomDiagnosticsEnabled = String(process.env.GOMOKU_ROOM_DIAGNOSTICS || '1').trim() !== '0';
// Tags let operators correlate a room/session during this process lifetime without
// putting joinable room codes, tickets, account IDs, or user content in journald.
const roomDiagnosticsKey = randomBytes(32);
const roomDiagnosticRateBuckets = new Map();
const ROOM_DIAGNOSTIC_WINDOW_MS = 60_000;
const ROOM_DIAGNOSTIC_MAX_PER_EVENT = 1200;

function privateDiagnosticTag(value) {
  const text = String(value || '').slice(0, 160);
  if (!text) return '';
  return createHmac('sha256', roomDiagnosticsKey).update(text).digest('hex').slice(0, 12);
}

function emitDiagnosticRecord(record) {
  const rateKey = `${record.component}:${record.event}:${record.reasonCode || ''}`;
  const now = Date.now();
  let bucket = roomDiagnosticRateBuckets.get(rateKey);
  if (!bucket || now - bucket.startedAt >= ROOM_DIAGNOSTIC_WINDOW_MS) {
    if (bucket?.suppressed) {
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        component: record.component,
        event: 'events.suppressed',
        sourceEvent: record.event,
        reasonCode: record.reasonCode || '',
        suppressed: bucket.suppressed
      }));
    }
    bucket = { startedAt: now, count: 0, suppressed: 0 };
    roomDiagnosticRateBuckets.set(rateKey, bucket);
  }
  if (bucket.count >= ROOM_DIAGNOSTIC_MAX_PER_EVENT) {
    bucket.suppressed += 1;
    return;
  }
  bucket.count += 1;
  console.info(JSON.stringify(record));
}

function writeRoomDiagnostic(event = {}) {
  if (!roomDiagnosticsEnabled || !event || typeof event !== 'object') return;
  const record = {
    timestamp: new Date().toISOString(),
    level: 'info',
    component: 'room-relay',
    event: String(event.event || 'unknown').replace(/[^a-z0-9_.-]/gi, '').slice(0, 64) || 'unknown'
  };
  const tagFields = [
    ['roomCode', 'roomTag'], ['roomSessionId', 'roomSessionTag'],
    ['sessionId', 'connectionSessionTag'], ['requestedSessionId', 'requestedSessionTag'],
    ['expectedSessionId', 'expectedSessionTag'], ['previousSessionId', 'previousSessionTag'],
    ['nextSessionId', 'nextSessionTag'], ['roundId', 'roundTag'],
    ['nextRoundId', 'nextRoundTag'], ['requestId', 'requestTag']
  ];
  for (const [source, target] of tagFields) {
    const tag = privateDiagnosticTag(event[source]);
    if (tag) record[target] = tag;
  }
  if (/^[A-Za-z0-9_-]{1,40}$/.test(String(event.connectionId || ''))) record.connectionId = event.connectionId;
  if (event.role === 'host' || event.role === 'client') record.role = event.role;
  if (typeof event.messageType === 'string') {
    record.messageType = event.messageType.replace(/[^a-z0-9_]/gi, '').slice(0, 48) || 'unknown';
  }
  if (typeof event.direction === 'string' && /^(host_to_client|client_to_host)$/.test(event.direction)) record.direction = event.direction;
  if (typeof event.reasonCode === 'string') record.reasonCode = event.reasonCode.replace(/[^a-z0-9_]/gi, '').slice(0, 48);
  for (const key of ['peerPresent', 'requestedSessionMismatch', 'forwarded', 'isOver']) {
    if (typeof event[key] === 'boolean') record[key] = event[key];
  }
  for (const key of ['payloadBytes', 'closeCode', 'connectionAgeMs', 'queueLength', 'stepCount', 'statusCode']) {
    if (Number.isSafeInteger(event[key]) && event[key] >= 0) record[key] = Math.min(event[key], 10_000_000);
  }
  if (event.counts && typeof event.counts === 'object') {
    const counts = Object.create(null);
    for (const [key, value] of Object.entries(event.counts)) {
      if (/^(ping|pong|move|chat)_(forwarded|no_peer)$/.test(key) && Number.isSafeInteger(value) && value > 0) {
        counts[key] = Math.min(value, 1_000_000);
      }
    }
    if (Object.keys(counts).length) record.counts = counts;
  }
  emitDiagnosticRecord(record);
}

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('GOMOKU_ECS_PORT must be an integer from 1 to 65535');
  return port;
}

function parseOrigin(value) {
  const origin = String(value || '').trim();
  if (!origin || origin === 'null') throw new Error('An explicit serialized origin is required');
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Origin entries must contain only scheme and host');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only HTTP(S) origins are supported');
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Non-loopback configured origins must use HTTPS');
  }
  return origin;
}

function configuredOrigins() {
  const raw = String(process.env.GOMOKU_ALLOWED_ORIGINS || '');
  return new Set(raw.split(',').map(item => item.trim()).filter(Boolean).map(parseOrigin));
}

function workerAcceptsOrigin(origin) {
  if (!origin || origin === 'null') return true;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    const officialSite = parsed.protocol === 'https:' &&
      (parsed.hostname === 'gomoku-home.pages.dev' || parsed.hostname.endsWith('.gomoku-home.pages.dev')) &&
      !parsed.username && !parsed.password && !parsed.port;
    const apiSite = origin === 'https://gomoku-api.pages.dev';
    return local || officialSite || apiSite;
  } catch (_) {
    return false;
  }
}

function createNodeWebSocketServer() {
  const require = createRequire(import.meta.url);
  let ws;
  try {
    ws = require('ws');
  } catch (_) {
    throw new Error('The ECS adapter requires the Node "ws" module; install it in the runtime environment.');
  }
  const WebSocketServer = ws.WebSocketServer || ws.Server;
  if (typeof WebSocketServer !== 'function') throw new Error('The installed "ws" module has no WebSocketServer export');
  return new WebSocketServer({ noServer: true, maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES, perMessageDeflate: false });
}

function requestOriginForNodeRequest(request) {
  try {
    const host = String(request.headers.host || `${LOOPBACK_HOST}:${DEFAULT_PORT}`).trim();
    if (!host || host.includes('/') || host.includes('\\') || /[\r\n]/.test(host)) throw new Error('Invalid host');
    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const protocol = forwardedProto === 'https' || Boolean(request.socket.encrypted) ? 'https:' : 'http:';
    const parsed = new URL(`${protocol}//${host}`);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Invalid host');
    return parsed.origin;
  } catch (_) {
    const error = new Error('Invalid request host');
    error.statusCode = 400;
    throw error;
  }
}

function workerRequestHeaders(nodeHeaders, { websocket = false, rewrittenOrigin = '' } = {}) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeHeaders || {})) {
    const lower = name.toLowerCase();
    if (lower === 'host' || HOP_BY_HOP_HEADERS.has(lower) || value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }
  if (websocket) headers.set('Upgrade', 'websocket');
  if (rewrittenOrigin) headers.set('Origin', rewrittenOrigin);
  return headers;
}

async function readRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return size ? Buffer.concat(chunks) : undefined;
}

function requestUrl(request) {
  const origin = requestOriginForNodeRequest(request);
  const rawUrl = String(request.url || '/');
  try {
    const url = new URL(rawUrl, origin);
    if (url.origin !== origin || url.username || url.password) throw new Error('Invalid URL credentials');
    return url;
  } catch (_) {
    const error = new Error('Invalid request URL');
    error.statusCode = 400;
    throw error;
  }
}

function validateAndRewriteOrigin(headers, allowedOrigins) {
  const origin = headers.get('Origin') || '';
  if (!origin || origin === 'null' || workerAcceptsOrigin(origin)) return { original: origin, rewritten: false };
  if (!allowedOrigins.has(origin)) return { original: origin, rewritten: false };

  // The Worker has a fixed official-site allowlist. Only origins explicitly
  // configured by the operator are mapped into that allowlist; CORS is mapped
  // back to the exact configured origin on the response.
  headers.set('Origin', WORKER_ALLOWED_ORIGIN);
  return { original: origin, rewritten: true };
}

async function toWorkerRequest(request, { websocket = false, allowedOrigins }) {
  const url = requestUrl(request);
  const headers = workerRequestHeaders(request.headers, { websocket });
  const origin = validateAndRewriteOrigin(headers, allowedOrigins);
  const body = await readRequestBody(request);
  const init = { method: request.method, headers };
  if (body !== undefined) init.body = body;
  return {
    request: new Request(url, init),
    context: origin
  };
}

function responseHeaders(response, context) {
  const headers = new Headers(response.headers);
  if (context?.rewritten && headers.has('Access-Control-Allow-Origin')) {
    headers.set('Access-Control-Allow-Origin', context.original);
    const vary = headers.get('Vary') || '';
    if (!vary.toLowerCase().split(',').map(value => value.trim()).includes('origin')) {
      headers.set('Vary', vary ? `${vary}, Origin` : 'Origin');
    }
  }
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  return headers;
}

function nodeHeaderObject(headers) {
  const result = Object.create(null);
  for (const [name, value] of headers) result[name] = value;
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (cookies.length) result['set-cookie'] = cookies;
  return result;
}

function sendNodeResponse(nodeResponse, workerResponse, context) {
  const headers = responseHeaders(workerResponse, context);
  const status = Number(workerResponse.status) || 500;
  nodeResponse.writeHead(status, nodeHeaderObject(headers));
  if (nodeResponse.req?.method === 'HEAD' || status === 204 || status === 304) {
    nodeResponse.end();
    return;
  }
  if (!workerResponse.body) {
    nodeResponse.end();
    return;
  }
  const bodyStream = Readable.fromWeb(workerResponse.body);
  bodyStream.on('error', error => {
    const errorId = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    console.error(`[gomoku-ecs][${errorId}] response stream failed (${safeErrorName(error)})`);
    if (!nodeResponse.destroyed) nodeResponse.destroy();
  });
  nodeResponse.once('close', () => {
    if (!nodeResponse.writableEnded) bodyStream.destroy();
  });
  bodyStream.pipe(nodeResponse);
}

async function sendWebSocketUpgradeError(socket, workerResponse, context) {
  const candidateStatus = Number(workerResponse?.status) || 502;
  const status = candidateStatus === 101 ? 500 : candidateStatus;
  let body = Buffer.alloc(0);
  try { body = Buffer.from(await workerResponse.arrayBuffer()); } catch (_) {}
  const headers = responseHeaders(workerResponse, context);
  headers.set('Connection', 'close');
  headers.set('Content-Length', String(body.length));
  const statusText = STATUS_CODES[status] || 'Error';
  const head = [`HTTP/1.1 ${status} ${statusText}`];
  for (const [name, value] of headers) head.push(`${name}: ${value}`);
  socket.end(`${head.join('\r\n')}\r\n\r\n${body.toString('binary')}`, 'binary');
}

function bridgePairToNetwork(workerSocket, networkSocket) {
  if (!(workerSocket instanceof WorkerWebSocket) || !workerSocket._peer) {
    throw new Error('Worker returned an invalid WebSocketPair endpoint');
  }
  const networkFacing = workerSocket;
  const workerFacing = workerSocket._peer;
  networkFacing._attachNetwork(networkSocket);

  networkSocket.on('message', (data, isBinary) => networkFacing._receiveNetwork(data, isBinary));
  networkSocket.on('close', (code, reason) => networkFacing._finish(code, reason.toString('utf8'), code === 1000));
  networkSocket.on('error', error => {
    networkFacing._dispatch('error', { error });
    networkFacing._finish(1011, 'WebSocket error', false);
  });
  return workerFacing;
}

function sendPlainError(response, status, message, errorId = '') {
  const payload = { code: status };
  if (errorId) payload.errorId = errorId;
  payload.msg = errorId ? `${message}（错误码 ${errorId}，请提供给维护者）` : message;
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

installWorkerResponseCompatibility();
globalThis.WebSocketPair = WebSocketPair;

const wsServer = createNodeWebSocketServer();
const databasePath = process.env.GOMOKU_DB_PATH;
if (!databasePath) throw new Error('Set GOMOKU_DB_PATH to a persistent SQLite file path before starting the ECS adapter.');

const database = new D1Database(databasePath);
const allowedOrigins = configuredOrigins();
const workerUrl = new URL('../worker.js', import.meta.url);
const workerModule = await import(workerUrl.href);
const worker = workerModule.default;
if (!worker || typeof worker.fetch !== 'function') throw new Error('backend/worker.js does not export a Worker fetch handler');

const reportBackgroundError = error => {
  console.error(`[gomoku-ecs] background task failed (${safeErrorName(error)})`);
};
const env = makeRuntimeEnv(database, null, null);
env.GOMOKU_DIAGNOSTICS = { logRoomEvent: writeRoomDiagnostic };
const rooms = new MemoryDurableObjectNamespace(workerModule.GomokuRoom, env, { onBackgroundError: reportBackgroundError });
const social = new MemoryDurableObjectNamespace(workerModule.SocialHub, env, { onBackgroundError: reportBackgroundError });
env.GOMOKU_ROOMS = rooms;
env.GOMOKU_SOCIAL = social;
const pendingUpgradeSockets = new Set();

const server = createServer(async (request, response) => {
  let pathname = '/';
  try {
    pathname = requestUrl(request).pathname;
    if (HEALTH_PATHS.has(pathname) && (request.method === 'GET' || request.method === 'HEAD')) {
      const dbProbe = await database.prepare('SELECT 1 AS ok').first();
      const healthy = Number(dbProbe?.ok) === 1;
      const body = Buffer.from(JSON.stringify({ ok: healthy, service: 'gomoku-ecs-api', db: healthy ? 'ok' : 'error' }));
      response.writeHead(healthy ? 200 : 503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': body.length,
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    if (HEALTH_PATHS.has(pathname)) {
      sendPlainError(response, 405, '仅支持 GET 请求');
      return;
    }

    const { request: workerRequest, context } = await toWorkerRequest(request, { allowedOrigins });
    const workerResponse = await worker.fetch(workerRequest, env);
    if (workerResponse.status === 101 && workerResponse.webSocket) {
      sendPlainError(response, 500, 'WebSocket upgrades require an HTTP upgrade request');
      return;
    }
    sendNodeResponse(response, workerResponse, context);
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    const errorId = status >= 500 ? randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase() : '';
    if (errorId) console.error(`[gomoku-ecs][${errorId}] ${request.method} ${pathname} failed (${safeErrorName(error)})`, error?.stack || error?.message || error);
    if (!response.headersSent) sendPlainError(response, status, status === 413 ? '请求数据过大' : status === 400 ? '请求无效' : '服务器暂不可用', errorId);
    else response.destroy();
  }
});

server.on('upgrade', (request, socket, head) => {
  const requestId = randomUUID().replace(/-/g, '').slice(0, 12);
  const startedAt = Date.now();
  const logUpgrade = fields => emitDiagnosticRecord({
    timestamp: new Date().toISOString(),
    level: 'info',
    component: 'websocket-transport',
    requestId,
    ...fields
  });
  pendingUpgradeSockets.add(socket);
  socket.once('close', () => pendingUpgradeSockets.delete(socket));
  if (shuttingDown) {
    logUpgrade({ event: 'upgrade.rejected', reasonCode: 'server_shutting_down', statusCode: 503 });
    socket.destroy();
    return;
  }
  void (async () => {
    let pathname = '/';
    try {
      pathname = requestUrl(request).pathname;
      const { request: workerRequest, context } = await toWorkerRequest(request, { websocket: true, allowedOrigins });
      const workerResponse = await worker.fetch(workerRequest, env);
      if (shuttingDown || socket.destroyed) {
        try { workerResponse?.webSocket?.close(1001, 'Server shutting down'); } catch (_) {}
        pendingUpgradeSockets.delete(socket);
        return;
      }
      if (workerResponse.status !== 101 || !workerResponse.webSocket) {
        logUpgrade({
          event: 'upgrade.rejected',
          reasonCode: 'worker_rejected',
          statusCode: Number(workerResponse.status) || 502,
          durationMs: Math.max(0, Date.now() - startedAt)
        });
        await sendWebSocketUpgradeError(socket, workerResponse, context);
        return;
      }

      wsServer.handleUpgrade(request, socket, head, networkSocket => {
        try {
          bridgePairToNetwork(workerResponse.webSocket, networkSocket);
          const openedAt = Date.now();
          const connectionId = requestId;
          logUpgrade({
            event: 'upgrade.accepted',
            statusCode: 101,
            durationMs: Math.max(0, openedAt - startedAt)
          });
          networkSocket.once('close', code => logUpgrade({
            event: 'connection.closed',
            connectionId,
            closeCode: Number.isInteger(code) ? code : 1006,
            connectionAgeMs: Math.max(0, Date.now() - openedAt)
          }));
          networkSocket.once('error', error => logUpgrade({
            event: 'connection.error',
            connectionId,
            errorType: safeErrorName(error)
          }));
          wsServer.emit('connection', networkSocket, request);
          pendingUpgradeSockets.delete(socket);
        } catch (error) {
          logUpgrade({ event: 'upgrade.bridge_failed', errorType: safeErrorName(error) });
          try { networkSocket.close(1011, 'WebSocket bridge failed'); } catch (_) {}
          pendingUpgradeSockets.delete(socket);
        }
      });
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      logUpgrade({
        event: 'upgrade.error',
        reasonCode: 'worker_exception',
        statusCode: status,
        errorType: safeErrorName(error),
        durationMs: Math.max(0, Date.now() - startedAt)
      });
      if (status >= 500) console.error(`[gomoku-ecs] WebSocket ${pathname} failed (${safeErrorName(error)})`);
      if (!socket.destroyed) {
        const body = Buffer.from(status === 400 ? 'Bad Request' : status === 413 ? 'Payload Too Large' : 'Service Unavailable');
        const statusText = STATUS_CODES[status] || 'Error';
        socket.end(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body.toString('binary')}`, 'binary');
      }
    }
  })();
});

const port = parsePort(process.env.GOMOKU_ECS_PORT);
server.listen(port, LOOPBACK_HOST, () => {
  console.log(`[gomoku-ecs] listening on http://${LOOPBACK_HOST}:${port}`);
  console.log('[gomoku-ecs] health probe: /healthz');
});

let shuttingDown = false;

async function drainBackgroundTasks() {
  while (true) {
    const tasks = [rooms, social].flatMap(namespace =>
      Array.from(namespace.instances.values()).flatMap(record => Array.from(record.state.backgroundTasks))
    );
    if (!tasks.length) return;
    await Promise.allSettled(tasks);
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[gomoku-ecs] received ${signal}; shutting down`);

  const forceExit = setTimeout(() => {
    for (const client of wsServer.clients) {
      try { client.terminate(); } catch (_) {}
    }
    try { database.close(); } catch (_) {}
    process.exit(1);
  }, 15000);
  const httpClosed = new Promise(resolve => {
    if (!server.listening) return resolve();
    try { server.close(() => resolve()); } catch (_) { resolve(); }
  });
  for (const socket of pendingUpgradeSockets) {
    try { socket.destroy(); } catch (_) {}
  }
  const sockets = Array.from(wsServer.clients);
  const socketsClosed = Promise.all(sockets.map(client => new Promise(resolve => {
    if (client.readyState === 3) return resolve();
    const timeout = setTimeout(() => {
      try { client.terminate(); } catch (_) {}
      resolve();
    }, 5000);
    timeout.unref();
    client.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    try { client.close(1001, 'Server shutting down'); } catch (_) {
      clearTimeout(timeout);
      resolve();
    }
  })));

  await Promise.all([httpClosed, socketsClosed]);
  await drainBackgroundTasks();
  await new Promise(resolve => {
    try { wsServer.close(() => resolve()); } catch (_) { resolve(); }
  });
  try { database.close(); } catch (_) {}
  clearTimeout(forceExit);
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
