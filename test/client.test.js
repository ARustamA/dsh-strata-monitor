/**
 * The client half of the monitor: how often the panel asks for fresh numbers,
 * and what the tooltip does while the pointer rests on it.
 *
 * The panel polls the host route, so the refresh cadence is decided by the
 * poll interval of that timer. The module registers itself through the
 * browser's module loader and never runs outside a browser, so the test
 * provides the loader, a minimal React, and the two browser globals it
 * touches (fetch, setInterval).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const loaded = [];
globalThis.window = {
    __ModuleLoader__: {
        load(config) {
            loaded.push(config);
        },
    },
};

await import('../client.js');

const config = loaded[0];
assert.ok(config, 'the client module must register itself with the module loader');

/**
 * A minimal React: element factory, one state hook, one effect hook. The
 * hooks delegate to the renderer that is currently rendering, so the module
 * can capture them once at factory time.
 */
let active = null;
const React = {
    createElement(type, props, ...children) {
        // React takes a single array argument as the whole child list
        const list = children.length === 1 && Array.isArray(children[0]) ? children[0] : children;
        return { type, props: { ...props, children: list } };
    },
    useState(initial) {
        return active.useState(initial);
    },
    useEffect(effect) {
        active.useEffect(effect);
    },
};

/** A renderer that can be called again to re-render the same component. */
function createRenderer() {
    const state = [];
    let cursor = 0;
    let effects = [];
    const renderer = {
        useState(initial) {
            const slot = cursor++;
            if (!(slot in state))
                state[slot] = typeof initial === 'function' ? initial() : initial;
            const set = (next) => {
                state[slot] = typeof next === 'function' ? next(state[slot]) : next;
            };
            return [state[slot], set];
        },
        useEffect(effect) {
            effects.push(effect);
        },
        render() {
            cursor = 0;
            effects = [];
            const previous = active;
            active = renderer;
            try {
                const element = registered.Component();
                for (const effect of effects) effect();
                return element;
            }
            finally {
                active = previous;
            }
        },
    };
    return renderer;
}

const module = config.factory(() => React);
assert.ok(module, 'the module factory must return the client module');

let registered = null;
module.apply({
    slots: {
        inject(slot, callback) {
            registered = callback();
        },
        register(descriptor, Component) {
            return { ...descriptor, Component };
        },
    },
});
assert.ok(registered?.Component, 'the panel must register itself in the composer dock');

/** Let the fetch promise chain settle. */
async function flush() {
    for (let i = 0; i < 6; i++)
        await Promise.resolve();
}

/**
 * Mount the panel with a controllable fetch: the test decides what each poll
 * answers and when.
 */
function mount(t) {
    const timers = [];
    const requests = [];
    const pending = [];
    const realSetInterval = globalThis.setInterval;
    const realFetch = globalThis.fetch;
    globalThis.setInterval = (fn, delay) => {
        timers.push({ fn, delay });
        return { unref() {} };
    };
    globalThis.fetch = (url) => {
        requests.push(url);
        return new Promise((resolve) => pending.push(resolve));
    };
    t.after(() => {
        globalThis.setInterval = realSetInterval;
        globalThis.fetch = realFetch;
    });

    const renderer = createRenderer();
    renderer.render();

    return {
        timers,
        requests,
        renderer,
        /** Answer the next poll with this payload and re-render. */
        async answer(payload) {
            pending.shift()?.({ json: () => Promise.resolve(payload) });
            await flush();
            return renderer.render();
        },
        /** Trigger the poll timer, as the browser would every five seconds. */
        poll() {
            timers[0]?.fn();
        },
    };
}

const payload = (tokS) => ({
    ok: true,
    state: 'busy',
    phase: 'answering',
    tok_s: tokS,
    tok_s_mean: tokS,
    generated: 100,
    prompt_tokens: 200,
    queued: 0,
    model: 'qwen3.8-flash-next-abliterated-iq3_s',
    engine: '0.1.56',
    vram_free_mib: 1457,
    arena_mib: 47962,
    expert_cache_mib: 6978,
    last_request: null,
});

/** The pill's visible label: the third child carries the value. */
function labelOf(element) {
    return String(element.props.children[2].props.children);
}

/** The tooltip element, when it is open. */
function tooltipOf(element) {
    const children = element?.props?.children ?? [];
    return children.find?.((child) => child?.props?.role === 'tooltip') ?? null;
}

test('the panel refreshes every five seconds', (t) => {
    const panel = mount(t);
    assert.equal(panel.timers.length, 1, 'the panel must schedule exactly one poll timer');
    assert.equal(panel.timers[0].delay, 5000);
});

test('the panel polls the host route', (t) => {
    const panel = mount(t);
    assert.deepEqual(panel.requests, ['/strata/monitor']);
});

test('the tooltip is an element of the page, not the browser title bubble', async (t) => {
    const panel = mount(t);

    const first = await panel.answer(payload(70));
    assert.equal(tooltipOf(first), null, 'the tooltip is closed before the pointer arrives');
    assert.equal(first.props.title, undefined, 'the native title bubble must not be used');

    // the pointer arrives: the tooltip opens as a real element
    first.props.onMouseEnter();
    const hovered = panel.renderer.render();
    const tip = tooltipOf(hovered);
    assert.ok(tip, 'hovering must open the tooltip');
    assert.match(String(tip.props.children), /70/);

    // the next poll brings new numbers — the tooltip stays open and updates
    panel.poll();
    const refreshed = await panel.answer(payload(91));
    const tip2 = tooltipOf(refreshed);
    assert.ok(tip2, 'the tooltip must stay open while the numbers refresh');
    assert.match(String(tip2.props.children), /91/);
    assert.match(labelOf(refreshed), /91/, 'the visible value still updates while hovered');

    // the pointer leaves: the tooltip closes
    refreshed.props.onMouseLeave();
    const left = panel.renderer.render();
    assert.equal(tooltipOf(left), null);
});

test('the tooltip is drawn as a floating box that cannot steal the pointer', async (t) => {
    const panel = mount(t);
    const first = await panel.answer(payload(70));
    first.props.onMouseEnter();
    const hovered = panel.renderer.render();
    const tip = tooltipOf(hovered);

    assert.equal(tip.props.style.position, 'absolute', 'the tooltip must float above the panel');
    assert.equal(tip.props.style.pointerEvents, 'none', 'the tooltip must not intercept the pointer');
    assert.equal(tip.props.style.whiteSpace, 'pre-wrap', 'the tooltip must keep its line breaks and wrap long ones');
    assert.ok(first.props.style.position, 'the panel must be the positioning anchor');
});
