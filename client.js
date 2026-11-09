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

        const CONTAINER = {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            lineHeight: 1.4,
            opacity: 0.85,
            whiteSpace: 'nowrap',
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
            const last = data.last_request;
            if (last !== null) {
                lines.push(`last request: ${last.duration_s ?? '?'} s, ${last.prompt_tokens ?? '?'} prompt tokens, ${last.output_tokens ?? '?'} out, ${last.decode_tok_s ?? '?'} tok/s decode, cache hit ${last.hit_rate === null ? '?' : `${Math.round(last.hit_rate * 100)}%`}`);
            }
            return lines.join('\n');
        }

        function StrataPill() {
            const [data, setData] = useState(null);
            const [hovered, setHovered] = useState(false);
            const [tip, setTip] = useState(null);

            useEffect(() => {
                let stopped = false;
                const load = () => {
                    fetch('/strata/monitor', { cache: 'no-store' })
                        .then((response) => response.json())
                        .then((payload) => {
                            if (!stopped)
                                setData(payload);
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
            }, []);

            if (data === null)
                return null;

            const state = data.state ?? 'offline';
            const label = state === 'busy'
                ? `${data.tok_s ?? 0} t/s`
                : state === 'idle' ? 'idle' : 'offline';

            // The tooltip is a snapshot: a browser closes it as soon as the
            // `title` attribute changes, so a refreshing panel would make it
            // vanish every poll. While the pointer rests on the panel the
            // text is held still, so it can be read — and screenshotted.
            const live = describe(data);
            const title = hovered ? (tip ?? live) : live;

            return h('span', {
                'data-strata-monitor': 'true',
                title,
                onMouseEnter: () => {
                    setTip(live);
                    setHovered(true);
                },
                onMouseLeave: () => {
                    setHovered(false);
                    setTip(null);
                },
                style: CONTAINER,
            }, [
                h('span', { key: 'dot', style: { ...DOT, background: dotColor(state) } }),
                h('span', { key: 'name' }, 'Strata'),
                h('span', { key: 'value', style: { opacity: 0.75 } }, label),
            ]);
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
