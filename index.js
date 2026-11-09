import { buildOffline, buildSummary } from './lib/summary.js';

export const name = 'dsh-strata-monitor';

/**
 * The services this plugin needs.
 *
 * The web server is *declared*, not looked up: the composition creates it
 * after a plugin module is loaded, so a plugin that asks the context for it
 * at apply time can get nothing back and quietly never claim its route.
 */
export const inject = ['webServer'];

/** Strata's own address; the DSH profile points its Strata provider here too. */
const STRATA_URL = (process.env.STRATA_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');

/** A stalled Strata must not stall the panel: give up after this long. */
const TIMEOUT_MS = 3000;

/** Read one JSON endpoint of Strata. */
async function readJson(path) {
    const url = `${STRATA_URL}${path}`;
    const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
    });
    if (!response.ok)
        throw new Error(`${path} answered HTTP ${response.status}`);
    return await response.json();
}

/** Send a JSON response with no-store caching. */
function sendJson(response, status, body) {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(payload);
}

/** Whether the request comes from the page this server served. */
function sameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin === undefined)
        return true;
    if (host === undefined)
        return false;
    return origin === `http://${host}` || origin === `https://${host}`;
}

/**
 * Host half of the bundle: one read-only route that carries Strata's live
 * numbers to the browser. The panel talks to this route instead of Strata
 * itself, so the browser never needs a cross-origin grant from Strata.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/strata/monitor',
        handler: async (request, response) => {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                sendJson(response, 405, { error: 'method not allowed' });
                return;
            }
            if (!sameOrigin(request)) {
                sendJson(response, 403, { error: 'cross-origin request refused' });
                return;
            }
            try {
                const [status, metrics] = await Promise.all([
                    readJson('/status'),
                    readJson('/metrics'),
                ]);
                sendJson(response, 200, buildSummary(status, metrics));
            }
            catch (error) {
                sendJson(response, 200, buildOffline(error instanceof Error ? error.message : String(error)));
            }
        },
    }), 'strata-monitor: /strata/monitor');
}
