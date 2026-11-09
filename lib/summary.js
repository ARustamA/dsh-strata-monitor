/**
 * Build the compact Strata summary the GUI panel renders.
 *
 * Pure function: the two parsed JSON payloads of Strata's `/status` and
 * `/metrics` endpoints go in, one plain summary object comes out. Every field
 * of Strata's answer is optional, so every read here is defensive: a missing
 * number becomes null, never NaN and never an exception.
 */

/** A finite number, or null when the value is absent or not a number. */
function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The newest request row, or null when Strata has no history yet. */
function lastRequest(requests) {
    if (!Array.isArray(requests) || requests.length === 0)
        return null;
    const row = requests[requests.length - 1] ?? {};
    return {
        duration_s: num(row.duration_s),
        prompt_tokens: num(row.prompt_tokens),
        output_tokens: num(row.output_tokens),
        hit_rate: num(row.hit_rate),
        decode_tok_s: num(row.decode_tok_s),
        pcie_share: num(row.pcie_share),
    };
}

/**
 * @param {object} status parsed body of Strata's `/status`
 * @param {object} metrics parsed body of Strata's `/metrics`
 */
export function buildSummary(status, metrics) {
    const engine = metrics?.engine ?? {};
    const live = metrics?.live ?? {};
    const hardware = metrics?.hardware ?? {};
    const busy = status?.busy === true || live?.state === 'generating';
    const tokS = num(live?.tok_s) ?? num(status?.tokens_per_s);
    return {
        ok: true,
        state: busy ? 'busy' : 'idle',
        phase: status?.phase ?? live?.phase ?? null,
        queued: num(status?.queued) ?? num(live?.queued) ?? 0,
        tok_s: tokS,
        tok_s_mean: num(status?.tokens_per_s_mean) ?? num(live?.tok_s_mean),
        prefill_tok_s_mean: num(live?.prefill_tok_s_mean),
        generated: num(status?.generated) ?? num(live?.generated),
        prompt_tokens: num(status?.prompt_tokens) ?? num(live?.prompt_tokens),
        max_tokens: num(status?.max_tokens) ?? num(live?.max_tokens),
        elapsed_s: num(status?.elapsed_s) ?? num(live?.elapsed_s),
        model: typeof engine?.model === 'string' ? engine.model : null,
        engine: typeof engine?.engine === 'string' ? engine.engine : null,
        context: num(engine?.context) ?? num(engine?.max_context),
        vram_free_mib: num(engine?.vram_free_mib),
        arena_mib: num(engine?.arena_mib),
        expert_cache_mib: num(engine?.expert_cache_mib),
        gpu_temp_c: num(hardware?.gpu_temp),
        cpu_temp_c: num(hardware?.cpu),
        last_request: lastRequest(metrics?.requests),
    };
}

/**
 * The summary of an unreachable Strata: the panel shows "offline" instead of
 * pretending the model is idle.
 * @param {string} reason why Strata could not be read
 */
export function buildOffline(reason) {
    return {
        ok: false,
        state: 'offline',
        phase: null,
        queued: 0,
        tok_s: null,
        tok_s_mean: null,
        prefill_tok_s_mean: null,
        generated: null,
        prompt_tokens: null,
        max_tokens: null,
        elapsed_s: null,
        model: null,
        engine: null,
        context: null,
        vram_free_mib: null,
        arena_mib: null,
        expert_cache_mib: null,
        gpu_temp_c: null,
        cpu_temp_c: null,
        last_request: null,
        error: reason,
    };
}
