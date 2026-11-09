/**
 * The host half of the monitor: the route the GUI polls.
 *
 * The bug these tests guard against: the plugin asked the context for the
 * web server exactly once, at apply time, and quietly did nothing when the
 * server was not up yet. In the real composition the web server becomes
 * available *after* a plugin module is loaded, so the plugin applied itself
 * into a context that had no server — the route was never claimed and the
 * GUI polled a 404 forever.
 *
 * The fix follows the shape every other route-owning plugin in the harness
 * uses: declare the dependency (`inject`), so the loader applies the plugin
 * once the service exists, and claim the route through the injected service.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Nothing listens on port 1: the panel must read "offline", not throw.
process.env.STRATA_URL = 'http://127.0.0.1:1';

const { apply, inject, name } = await import('../index.js');

/** A web server that records the routes a plugin claims. */
function makeWebServer() {
    const routes = new Map();
    return {
        routes,
        register(route) {
            if (routes.has(route.path))
                throw new Error(`duplicate route ${route.path}`);
            routes.set(route.path, route);
            return () => routes.delete(route.path);
        },
    };
}

/**
 * A miniature of the cordis loader: a plugin that declares its dependency
 * in `inject` is applied once that service exists, a plugin that declares
 * nothing is applied straight away — while the service is still starting.
 */
async function load(plugin) {
    const services = {};
    const effects = [];
    const ctx = {
        // cordis resolves a service property only while it is available
        get webServer() {
            return services.webServer;
        },
        get(service) {
            return services[service];
        },
        effect(fn, label) {
            effects.push(label);
            fn();
            return () => {};
        },
    };

    const deps = Array.isArray(plugin.inject) ? plugin.inject : [];
    if (deps.length === 0) {
        plugin.apply(ctx);
    }
    else {
        // the loader waits for the declared services, then applies the plugin
        await Promise.all(deps.map((service) => new Promise((resolve) => {
            setTimeout(() => {
                services[service] = service === 'webServer' ? makeWebServer() : {};
                resolve();
            }, 0);
        })));
        plugin.apply(ctx);
    }
    return { ctx, services, effects };
}

/** One request/response exchange for the route handler. */
function makeExchange(method = 'GET', headers = {}) {
    const response = {
        statusCode: 200,
        headers: {},
        body: undefined,
        writeHead(status, headerValues) {
            this.statusCode = status;
            this.headers = headerValues;
            return this;
        },
        end(body) {
            this.body = body;
        },
    };
    return { request: { method, headers }, response };
}

test('the plugin claims the route the GUI polls', async () => {
    const { services } = await load({ name, inject, apply });

    const route = services.webServer?.routes.get('/strata/monitor');
    assert.ok(route, 'the /strata/monitor route must be registered');
    assert.equal(route.kind, 'exact');
    assert.equal(typeof route.handler, 'function');
});

test('the plugin declares the web server as its dependency', () => {
    assert.ok(Array.isArray(inject), 'the plugin must export its dependencies');
    assert.ok(inject.includes('webServer'), 'the web server must be a declared dependency');
});

test('the route is claimed through the injected service, not a one-shot lookup', async () => {
    const { effects } = await load({ name, inject, apply });
    assert.equal(effects.length, 1, 'the route must be claimed inside one effect');
});

test('the route answers a GET with the panel payload', async () => {
    const { services } = await load({ name, inject, apply });
    const route = services.webServer.routes.get('/strata/monitor');

    const { request, response } = makeExchange('GET');
    await route.handler(request, response);

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.ok, false);
    assert.equal(payload.state, 'offline');
});

test('the route refuses anything but GET and HEAD', async () => {
    const { services } = await load({ name, inject, apply });
    const route = services.webServer.routes.get('/strata/monitor');

    const { request, response } = makeExchange('POST');
    await route.handler(request, response);

    assert.equal(response.statusCode, 405);
});
