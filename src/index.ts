import { Env } from './types';
import { normalizeBasePath, stripBasePath } from '../shared/base-path';
import { NotificationsHub } from './durable/notifications-hub';
import { BackupTransferRunner } from './durable/backup-transfer-runner';
import { handleRequest } from './router';
import { StorageService } from './services/storage';
import { applyCors, jsonResponse } from './utils/response';
import { runScheduledBackupIfDue } from './handlers/backup';
import {
  isBackendRequestPath,
  isWebVaultHidden,
  webVaultNotFoundResponse,
} from './web-vault-visibility';

let dbInitialized = false;
let dbInitError: string | null = null;
let dbInitPromise: Promise<void> | null = null;

function normalizeRequestUrl(request: Request): Request {
  const url = new URL(request.url);
  const normalizedPathname = url.pathname.length <= 1 ? url.pathname : url.pathname.replace(/\/+$/, '');
  if (normalizedPathname === url.pathname) return request;

  url.pathname = normalizedPathname;
  return new Request(url.toString(), request);
}

function addSearchIndexHeaders(request: Request, response: Response): Response {
  const url = new URL(request.url);
  const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
  const shouldNoIndex =
    url.pathname === '/robots.txt' ||
    contentType.includes('text/html');

  if (!shouldNoIndex) return response;

  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function maybeServeAsset(request: Request, env: Env, base: string): Promise<Response | null> {
  if (!env.ASSETS) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const path = stripBasePath(url.pathname, base)!;
  if (isBackendRequestPath(path)) return null;

  url.pathname = path;
  const response = await env.ASSETS.fetch(new Request(url.toString(), request));
  if (!response.ok || request.method === 'HEAD') return addSearchIndexHeaders(request, response);
  const type = response.headers.get('Content-Type') || '';
  let body: string | null = null;
  if (type.includes('text/html')) {
    body = (await response.text()).replace(/(src|href)=(['"])(?:\/(?!\/)|\.\/)/g, `$1=$2${base}/`);
    body = body.replace('</head>', `<meta name="nodewarden-base-path" content="${base}"></head>`);
  } else if (base && path === '/manifest.webmanifest') {
    const manifest = await response.json() as Record<string, unknown>;
    const prefix = (value: unknown): unknown => typeof value === 'string' && value.startsWith('/') ? base + value : value;
    for (const key of ['id', 'start_url', 'scope']) manifest[key] = prefix(manifest[key]);
    for (const key of ['icons', 'shortcuts']) {
      for (const item of (manifest[key] as Record<string, unknown>[] || [])) {
        item.src = prefix(item.src); item.url = prefix(item.url);
        for (const icon of (item.icons as Record<string, unknown>[] || [])) icon.src = prefix(icon.src);
      }
    }
    body = JSON.stringify(manifest);
  }
  if (body === null) return addSearchIndexHeaders(request, response);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length'); headers.delete('ETag');
  headers.set('Cache-Control', 'no-store');
  return addSearchIndexHeaders(request, new Response(body, { status: response.status, headers }));
}

async function ensureDatabaseInitialized(env: Env): Promise<void> {
  if (dbInitialized) return;

  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const storage = new StorageService(env.DB);
      await storage.initializeDatabase();
      dbInitialized = true;
      dbInitError = null;
    })()
      .catch((error: unknown) => {
        console.error('Failed to initialize database:', error);
        dbInitError = error instanceof Error ? error.message : 'Unknown database initialization error';
      })
      .finally(() => {
        dbInitPromise = null;
      });
  }

  await dbInitPromise;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    void ctx;
    let base: string;
    try { base = normalizeBasePath(env.BASE_PATH); } catch {
      return new Response('Invalid BASE_PATH configuration', { status: 500 });
    }
    const publicPath = new URL(request.url).pathname;
    const requestPath = stripBasePath(publicPath, base);
    if (requestPath === null) return new Response('Not Found', { status: 404 });
    if (base && publicPath === base && request.method === 'GET') {
      const url = new URL(request.url); url.pathname += '/';
      return Response.redirect(url.toString(), 308);
    }
    const headers = new Headers(request.headers);
    headers.set('X-NodeWarden-Base-Path', base);
    const normalizedRequest = normalizeRequestUrl(new Request(request, { headers }));

    if (isWebVaultHidden(env) && !isBackendRequestPath(requestPath)) {
      return webVaultNotFoundResponse(normalizedRequest);
    }

    const assetResponse = await maybeServeAsset(normalizedRequest, env, base);
    if (assetResponse) {
      return applyCors(normalizedRequest, assetResponse, env);
    }

    await ensureDatabaseInitialized(env);
    if (dbInitError) {
      // Log full error server-side, return generic message to client.
      console.error('DB init error (not forwarded to client):', dbInitError);
      const resp = jsonResponse(
        {
          error: 'Database not initialized',
          error_description: 'Database initialization failed. Check server logs for details.',
          ErrorModel: {
            Message: 'Service temporarily unavailable',
            Object: 'error',
          },
        },
        500
      );
      return applyCors(normalizedRequest, resp, env);
    }

    const resp = await handleRequest(normalizedRequest, env);
    return applyCors(normalizedRequest, resp, env);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    void controller;
    await ensureDatabaseInitialized(env);
    if (dbInitError) {
      console.error('Skipping scheduled backup because DB init failed:', dbInitError);
      return;
    }
    ctx.waitUntil(runScheduledBackupIfDue(env).catch((error) => {
      console.error('Scheduled backup failed:', error);
    }));
  },
};

export { NotificationsHub };
export { BackupTransferRunner };
