import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary } from '../lib/summary.js';

const status = {
    busy: true,
    queued: 0,
    phase: 'answering',
    prompt_tokens: 30,
    generated: 9,
    elapsed_s: 0.7,
    tokens_per_s: 36,
    tokens_per_s_mean: 36.9,
};

const metrics = {
    engine: {
        model: 'qwen3.8-flash-next-abliterated-iq3_s',
        engine: '0.1.56',
        context: 262144,
        vram_free_mib: 1457,
        arena_mib: 47962,
        expert_cache_mib: 6978,
    },
    live: { state: 'generating' },
    requests: [
        {
            duration_s: 49.8,
            prompt_tokens: 81065,
            output_tokens: 757,
            hit_rate: 0.722,
            decode_tok_s: 62.5,
            pcie_share: 0.076,
        },
    ],
};

test('busy Strata reports the live token rate and the phase', () => {
    const summary = buildSummary(status, metrics);
    assert.equal(summary.ok, true);
    assert.equal(summary.state, 'busy');
    assert.equal(summary.phase, 'answering');
    assert.equal(summary.tok_s, 36);
    assert.equal(summary.generated, 9);
    assert.equal(summary.prompt_tokens, 30);
    assert.equal(summary.queued, 0);
});

test('engine numbers reach the summary', () => {
    const summary = buildSummary(status, metrics);
    assert.equal(summary.model, 'qwen3.8-flash-next-abliterated-iq3_s');
    assert.equal(summary.engine, '0.1.56');
    assert.equal(summary.context, 262144);
    assert.equal(summary.vram_free_mib, 1457);
    assert.equal(summary.arena_mib, 47962);
    assert.equal(summary.expert_cache_mib, 6978);
});

test('the newest request becomes the last_request row', () => {
    const summary = buildSummary(status, metrics);
    assert.equal(summary.last_request.duration_s, 49.8);
    assert.equal(summary.last_request.prompt_tokens, 81065);
    assert.equal(summary.last_request.output_tokens, 757);
    assert.equal(summary.last_request.hit_rate, 0.722);
    assert.equal(summary.last_request.decode_tok_s, 62.5);
});

test('an idle Strata is idle, not busy', () => {
    const summary = buildSummary({ busy: false, queued: 0, phase: 'idle' }, { engine: {}, live: {}, requests: [] });
    assert.equal(summary.state, 'idle');
    assert.equal(summary.tok_s, null);
    assert.equal(summary.last_request, null);
});

test('missing fields never throw and never become NaN', () => {
    const summary = buildSummary({}, {});
    assert.equal(summary.ok, true);
    assert.equal(summary.state, 'idle');
    assert.equal(summary.tok_s, null);
    assert.equal(summary.vram_free_mib, null);
    assert.equal(summary.last_request, null);
});

test('the live block wins over the status block for the token rate', () => {
    const summary = buildSummary(status, { ...metrics, live: { tok_s: 12.5 } });
    assert.equal(summary.tok_s, 12.5);
});
