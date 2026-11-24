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

/**
 * The Strata the plugin falls back to when the profile configures no usable
 * server: the local instance, at the address the DSH profile points its
 * Strata provider at.
 */
const DEFAULT_URL = (process.env.STRATA_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');

/** A stalled Strata must not stall the panel: give up after this long. */
const TIMEOUT_MS = 3000;

/**
 * The configured Strata instances: `config.servers`, a list of
 * `{ name, url }` entries coming from the profile's patch layer
 * (cordis.patch.yml). The entries are checked where they enter and a broken
 * one is skipped; when nothing usable remains, the single default server
 * stands in. The first entry answers requests that name no server.
 */
function resolveServers(config) {
    const entries = Array.isArray(config?.servers) ? config.servers : [];
    const servers = [];
    for (const entry of entries) {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
        if (name === '' || !/^https?:\/\//i.test(url))
            continue;
        if (servers.some((server) => server.name === name))
            continue;
        servers.push({ name, url: url.replace(/\/+$/, '') });
    }
    if (servers.length === 0)
        servers.push({ name: 'local', url: DEFAULT_URL });
    return servers;
}

/** Read one JSON endpoint of the given Strata. */
async function readJson(base, path) {
    const response = await fetch(`${base}${path}`, {
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
 * itself, so the browser never needs a cross-origin grant from Strata —
 * which holds for a remote Strata exactly as for a local one.
 *
 * `config.servers` names the instances the panel can reach; `?server=<name>`
 * picks one, and every payload carries the answered server and the full list
 * so the panel can render its switch and heal a stale choice.
 */
export function apply(ctx, config) {
    const servers = resolveServers(config);
    const names = servers.map((server) => server.name);
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
            const wanted = new URLSearchParams((request.url ?? '').split('?')[1] ?? '').get('server');
            const server = servers.find((entry) => entry.name === wanted) ?? servers[0];
            try {
                const [status, metrics] = await Promise.all([
                    readJson(server.url, '/status'),
                    readJson(server.url, '/metrics'),
                ]);
                sendJson(response, 200, { ...buildSummary(status, metrics), server: server.name, servers: names });
            }
            catch (error) {
                const offline = buildOffline(error instanceof Error ? error.message : String(error));
                sendJson(response, 200, { ...offline, server: server.name, servers: names });
            }
        },
    }), 'strata-monitor: /strata/monitor');
}
