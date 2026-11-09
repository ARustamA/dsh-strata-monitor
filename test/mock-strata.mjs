/**
 * A stand-in for the Strata server: serves the two endpoints the monitor
 * reads (`/status` and `/metrics`) with payloads captured from a real Strata
 * 0.1.56 run. It lets the whole chain be verified — GUI → host route →
 * summary — without loading the 70 GiB model.
 *
 * Usage: node test/mock-strata.mjs [port]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8080);

const status = {
    busy: true,
    queued: 0,
    phase: 'answering',
    prompt_tokens: 30,
    generated: 9,
    max_tokens: 1500,
    reasoning_recoveries: 0,
    thinking_budget: null,
    tool: null,
    tail: 'The air in the basement was thick, tasting',
    elapsed_s: 0.7,
    tokens_per_s: 36,
    tokens_per_s_mean: 36.9,
};

const metrics = {
    engine: {
        model: 'qwen3.8-flash-next-abliterated-iq3_s',
        max_context: 262144,
        context: 262144,
        images: true,
        version: '0.1.56',
        engine: '0.1.56',
        logit_bias: 1,
        kv: 'q4_0',
        kv_resident: 32768,
        expert_slots: 3564,
        expert_cache_mib: 6978,
        spec: 12,
        mtp_max: 4,
        lookup: 3,
        vram_free_mib: 1457,
        cvec: 0,
        arena_mib: 47962,
        pool_workers: 7,
        pcie_frac: '0.35',
        spec_min_p: '0.50',
        conversation_cache_mib: 0,
        prefill_cap: 8192,
        prefill_stages: 1,
        stream_all_min: 3072,
    },
    live: {
        state: 'generating',
        queued: 0,
        phase: 'answering',
        prompt_tokens: 28,
        generated: 4,
        max_tokens: 1500,
        elapsed_s: 0.6,
        tok_s: 16,
        tok_s_mean: 27.4,
        prefill_tok_s_mean: 60.4,
        tok_s_window_s: 2,
    },
    requests: [
        {
            projection: 'chat',
            time: 1794152070.73,
            duration_s: 49.8,
            finish: 'stop',
            prompt_tokens: 81065,
            reused: 0,
            output_tokens: 757,
            prompt_total: 81065,
            prompt_read: 81065,
            reasoning_recoveries: 0,
            engine_generated: 757,
            prompt_ms: 37688,
            decode_ms: 12110.5,
            decode_tok_s: 62.5,
            hit_rate: 0.722,
            pcie_share: 0.076,
            drafts_offered: 671,
            drafts_accepted: 402,
        },
    ],
};

function send(response, body) {
    const payload = JSON.stringify(body);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(payload);
}

createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/status')
        send(response, status);
    else if (path === '/metrics')
        send(response, metrics);
    else {
        response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'not found' }));
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`mock Strata listening on http://127.0.0.1:${port}`);
});
