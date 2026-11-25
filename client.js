/**
 * Client half of the Strata monitor bundle.
 *
 * A pill next to the message composer: the model's state, its live token rate
 * and, in the tooltip, the numbers the host route carries from Strata.
 */
window.__ModuleLoader__.load({
    id: 'dsh-strata-monitor',
    factory(require) {
        const React = require('react');
        const h = React.createElement;
        const { useEffect, useState } = React;

        /** How often the panel asks the host route for fresh numbers. */
        const POLL_MS = 5000;

        /**
         * Where the browser remembers which Strata the reader chose. The key
         * is per chat: two chats can watch two different Strata at the same
         * time. A mount without a chat identity falls back to the shared key.
         */
        const SERVER_KEY = 'dsh-strata-monitor.server';

        function serverKey(sessionId) {
            return sessionId ? `${SERVER_KEY}.${sessionId}` : SERVER_KEY;
        }

        const CONTAINER = {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            position: 'relative',
        };

        /**
         * The dimming belongs to the readable parts only. An opacity on the
         * container would fade the whole subtree — including the tooltip's
         * surface — and the page would show through it.
         */
        const DIMMED = { opacity: 0.85 };

        /**
         * The server switch, rendered inside the pill only when the profile
         * configures more than one Strata. Clicking it cycles to the next one.
         */
        const SERVER_BUTTON = {
            ...DIMMED,
            font: 'inherit',
            fontSize: 'inherit',
            lineHeight: 1.2,
            color: 'inherit',
            background: 'transparent',
            border: '1px solid var(--dsw-alias-border-l2, #3a3a3c)',
            borderRadius: '4px',
            padding: '0 5px',
            cursor: 'pointer',
        };

        /**
         * The tooltip is a real element of the page, not the browser's native
         * `title` bubble: a native bubble is drawn by the browser itself, so it
         * vanishes the moment another program takes over the screen — exactly
         * what happens when a screenshot is cut out with the snipping tool.
         * As a DOM element it belongs to the page and is captured with it.
         */
        const TOOLTIP = {
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            // open to the left of the panel: a box that grows to the right
            // would reach past the window and add a horizontal scrollbar
            right: '100%',
            marginRight: '8px',
            zIndex: 100,
            pointerEvents: 'none',
            padding: '8px 10px',
            borderRadius: '6px',
            background: 'var(--dsw-specific-input-major, #2c2c2e)',
            color: 'var(--dsw-alias-label-primary, #f9fafb)',
            border: '1px solid var(--dsw-alias-border-l2, #3a3a3c)',
            boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.28))',
            fontFamily: 'var(--dsw-font-family, monospace)',
            fontSize: '12px',
            lineHeight: 1.5,
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            // a fixed width: an absolutely positioned box shrinks to fit its
            // content, and the long "last request" line would otherwise
            // stretch it past the edge of the window
            width: '340px',
            maxWidth: 'calc(100vw - 32px)',
            opacity: 1,
        };

        const DOT = { width: '8px', height: '8px', borderRadius: '50%', flex: 'none' };

        /** The state colour: amber while the model works, green when it waits. */
        function dotColor(state) {
            if (state === 'busy')
                return '#f59e0b';
            if (state === 'idle')
                return '#22c55e';
            return '#ef4444';
        }

        /** The tooltip: the full picture in one hover. */
        function describe(data) {
            if (!data?.ok)
                return `Strata: offline (${data?.error ?? 'no answer'})`;
            const lines = [
                `Strata ${data.model ?? 'unknown model'} (engine ${data.engine ?? '?'})`,
                `state: ${data.state}${data.phase ? ` / ${data.phase}` : ''}`,
            ];
            if (data.tok_s !== null)
                lines.push(`speed: ${data.tok_s} tok/s (mean ${data.tok_s_mean ?? '?'})`);
            if (data.generated !== null)
                lines.push(`tokens: ${data.generated} generated, ${data.prompt_tokens ?? '?'} in prompt, ${data.queued} queued`);
            if (data.vram_free_mib !== null)
                lines.push(`VRAM free: ${data.vram_free_mib} MiB, arena ${data.arena_mib ?? '?'} MiB, expert cache ${data.expert_cache_mib ?? '?'} MiB`);
            if (data.gpu_temp_c !== null || data.cpu_temp_c !== null)
                lines.push(`temperatures: GPU ${data.gpu_temp_c ?? '?'} °C, CPU ${data.cpu_temp_c ?? '?'} °C`);
            const last = data.last_request;
            if (last !== null) {
                lines.push(`last request: ${last.duration_s ?? '?'} s, ${last.prompt_tokens ?? '?'} prompt tokens, ${last.output_tokens ?? '?'} out, ${last.decode_tok_s ?? '?'} tok/s decode, cache hit ${last.hit_rate === null ? '?' : `${Math.round(last.hit_rate * 100)}%`}`);
            }
            return lines.join('\n');
        }

        function StrataPill({ sessionId }) {
            const [data, setData] = useState(null);
            const [hovered, setHovered] = useState(false);
            // the storage is the one truth about the choice, read on every
            // render: switching chats changes the key, and the poll below
            // follows the key it was given
            const [, setBump] = useState(0);
            const key = serverKey(sessionId);
            const server = localStorage.getItem(key);

            // one place writes the choice, so the pill and the healing below
            // cannot drift apart
            const choose = (next) => {
                localStorage.setItem(key, next);
                setBump((n) => n + 1);
            };

            useEffect(() => {
                let stopped = false;
                const path = server === null || server === ''
                    ? '/strata/monitor'
                    : `/strata/monitor?server=${encodeURIComponent(server)}`;
                const load = () => {
                    fetch(path, { cache: 'no-store' })
                        .then((response) => response.json())
                        .then((payload) => {
                            if (stopped)
                                return;
                            setData(payload);
                            // a remembered server may have left the profile's
                            // configuration; the host answered with one that
                            // is there, so the pill heals its own choice
                            const known = Array.isArray(payload?.servers) ? payload.servers : null;
                            if (server !== null && known !== null && !known.includes(server) && typeof payload?.server === 'string')
                                choose(payload.server);
                        })
                        .catch((error) => {
                            if (!stopped)
                                setData({ ok: false, state: 'offline', error: String(error) });
                        });
                };
                load();
                const timer = setInterval(load, POLL_MS);
                return () => {
                    stopped = true;
                    clearInterval(timer);
                };
            }, [server, sessionId]);

            if (data === null)
                return null;

            const state = data.state ?? 'offline';
            const label = state === 'busy'
                ? `${data.tok_s ?? 0} t/s`
                : state === 'idle' ? 'idle' : 'offline';
            const servers = Array.isArray(data.servers) ? data.servers : [];
            const active = server ?? data.server ?? servers[0] ?? null;

            const children = [
                h('span', { key: 'dot', style: { ...DOT, ...DIMMED, background: dotColor(state) } }),
                h('span', { key: 'name', style: DIMMED }, 'Strata'),
                h('span', { key: 'value', style: { opacity: 0.75 } }, label),
            ];
            if (servers.length > 1) {
                children.push(h('button', {
                    key: 'server',
                    type: 'button',
                    'aria-label': 'Strata server',
                    onClick: () => choose(servers[(servers.indexOf(active) + 1) % servers.length]),
                    style: SERVER_BUTTON,
                }, active));
            }
            if (hovered) {
                children.push(h('span', { key: 'tip', role: 'tooltip', style: TOOLTIP }, describe(data)));
            }

            return h('span', {
                'data-strata-monitor': 'true',
                'aria-label': describe(data),
                onMouseEnter: () => setHovered(true),
                onMouseLeave: () => setHovered(false),
                style: CONTAINER,
            }, children);
        }

        return {
            inject: ['slots'],
            apply(ctx) {
                ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
                    name: 'conversation.composer.dock',
                    id: 'strata-monitor',
                    order: 2,
                }, StrataPill));
            },
        };
    },
});
