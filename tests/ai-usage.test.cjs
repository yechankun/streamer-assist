"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePricing, validatePricingImport, mergePricing, estimateCost } = require("../electron/ai-usage.cjs");
const { loadTestAdapters } = require("./ai-test-adapters.cjs");

let adapters;
test.before(async () => { adapters = await loadTestAdapters(); });

function adapterPrice(providerId, modelId) {
  const row = adapters[providerId]?.pricing?.find(item => item.modelId === modelId);
  assert.ok(row, `Expected the verified ${providerId} adapter to publish exact pricing for ${modelId}`);
  return row;
}

function normalize(providerId, raw, source = "api") {
  const adapter = adapters[providerId];
  assert.equal(typeof adapter?.api?.normalizeUsage, "function");
  return adapter.api.normalizeUsage({ raw, source });
}

test("provider modules normalize input, cache, output, and reasoning token counts", () => {
  const responses = normalize("openai", {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
    output_tokens: 30,
    output_tokens_details: { reasoning_tokens: 10 },
    total_tokens: 130,
  });
  assert.deepEqual(responses, {
    inputTokens: 100,
    uncachedInputTokens: 75,
    cachedInputTokens: 20,
    cacheWriteInputTokens: 5,
    outputTokens: 30,
    thinkingTokens: 10,
    totalTokens: 130,
  });

  const chat = normalize("deepseek", {
    prompt_tokens: 80,
    prompt_cache_hit_tokens: 50,
    prompt_tokens_details: { cached_tokens: 50 },
    completion_tokens: 12,
    completion_tokens_details: { reasoning_tokens: 7 },
    total_tokens: 92,
  });
  assert.equal(chat.inputTokens, 80);
  assert.equal(chat.uncachedInputTokens, 30);
  assert.equal(chat.cachedInputTokens, 50);
  assert.equal(chat.thinkingTokens, 7);
  assert.equal(chat.totalTokens, 92);

  const claude = normalize("anthropic", {
    input_tokens: 10,
    cache_read_input_tokens: 50,
    cache_creation_input_tokens: 50,
    cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 },
    output_tokens: 4,
    output_tokens_details: { thinking_tokens: 2 },
  });
  assert.deepEqual(claude, {
    inputTokens: 110,
    uncachedInputTokens: 10,
    cachedInputTokens: 50,
    cacheWriteInputTokens: 50,
    cacheWrite5mInputTokens: 20,
    cacheWrite1hInputTokens: 30,
    outputTokens: 4,
    thinkingTokens: 2,
    totalTokens: 114,
  });

  const gemini = normalize("google", {
    promptTokenCount: 40,
    promptTokensDetails: { cachedContentTokenCount: 10 },
    candidatesTokenCount: 8,
    thoughtsTokenCount: 6,
    totalTokenCount: 48,
  });
  assert.equal(gemini.inputTokens, 40);
  assert.equal(gemini.uncachedInputTokens, 30);
  assert.equal(gemini.cachedInputTokens, 10);
  assert.equal(gemini.thinkingTokens, 6);
  assert.equal(gemini.totalTokens, 48);
});

test("estimates cached and uncached usage once from an exact imported model price", () => {
  const pricing = validatePricing({
    schemaVersion: 1, type: "model-pricing", providerId: "custom-local", modelId: "chat-model-v3", currency: "USD",
    inputPerMillion: 2, cachedInputPerMillion: 0.5, cacheWriteInputPerMillion: 1, outputPerMillion: 8,
    source: "https://provider.example/pricing", checkedAt: "2026-10-06",
  });
  const usage = normalize("openai", {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
    output_tokens: 30,
    total_tokens: 130,
  });
  const result = estimateCost({ providerId: "custom-local", modelId: "chat-model-v3", usage, pricing, at: "2026-10-06T12:00:00Z" });
  assert.deepEqual(result, {
    amount: 0.000405,
    currency: "USD",
    estimated: true,
    source: "https://provider.example/pricing",
    checkedAt: "2026-10-06",
    breakdown: { input: 0.000165, output: 0.00024 },
  });
});

test("legacy GPT-5.4 long-context arithmetic uses an explicit imported fixture", () => {
  const fixture = validatePricing({
    schemaVersion: 1, type: "model-pricing", providerId: "openai", modelId: "gpt-5.4", currency: "USD",
    inputPerMillion: 2.5, outputPerMillion: 15, source: "https://example.com/test-price", checkedAt: "2026-10-06",
    longContextThreshold: 272_000, longContext: { inputPerMillion: 5, outputPerMillion: 22.5 },
  });
  const result = estimateCost({ providerId: "openai", modelId: "gpt-5.4", usage: { inputTokens: 272_001, outputTokens: 100 }, pricing: fixture, at: "2026-10-06T12:00:00Z" });
  assert.equal(result.amount, 1.362255);
  assert.equal(result.breakdown.input, 1.360005);
  assert.equal(result.breakdown.output, 0.00225);
});

test("downloaded GPT-6 price records retain exact IDs, cache rates, and long-context thresholds", () => {
  const expected = [
    ["gpt-6.1-sol", 2, 0.1, 2.5, 10, 4, 0.2, 5, 15],
    ["gpt-6-sol", 2, 0.2, 2.5, 10, 4, 0.4, 5, 15],
    ["gpt-6-luna", 0.1, 0.01, 0.125, 0.5, 0.2, 0.02, 0.25, 0.75],
    ["gpt-6-astra", 10, 1, 12.5, 50, 20, 2, 25, 75],
  ];
  for (const [modelId, input, cached, write, output, longInput, longCached, longWrite, longOutput] of expected) {
    const row = adapterPrice("openai", modelId);
    assert.deepEqual([row.inputPerMillion, row.cachedInputPerMillion, row.cacheWriteInputPerMillion, row.outputPerMillion], [input, cached, write, output]);
    assert.deepEqual([row.longContext.inputPerMillion, row.longContext.cachedInputPerMillion, row.longContext.cacheWriteInputPerMillion, row.longContext.outputPerMillion], [longInput, longCached, longWrite, longOutput]);
    const result = estimateCost({ providerId: "openai", modelId, usage: { inputTokens: 272_001, outputTokens: 1 }, pricing: [row], at: "2026-10-06T12:00:00Z" });
    assert.equal(result.amount, Math.round((272_001 * longInput / 1_000_000 + longOutput / 1_000_000) * 1_000_000_000) / 1_000_000_000);
  }
});

test("Anthropic cache creation TTLs use separate published rates", () => {
  const usage = normalize("anthropic", {
    input_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 50,
    cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 }, output_tokens: 4,
  });
  const row = adapterPrice("anthropic", "claude-sonnet-4-6");
  assert.equal(row.cacheWrite5mInputPerMillion, 3.75);
  assert.equal(row.cacheWrite1hInputPerMillion, 6);
  const result = estimateCost({ providerId: "anthropic", modelId: row.modelId, usage, pricing: [row], at: "2026-10-06T12:00:00Z" });
  assert.equal(result.amount, 0.00036);
  assert.equal(result.breakdown.input, 0.0003);
  assert.equal(result.breakdown.output, 0.00006);
});

test("DeepSeek peak windows and Grok long-context rates use exact usage and request time", () => {
  const deepseekUsage = normalize("deepseek", {
    prompt_tokens: 100, prompt_cache_hit_tokens: 20, completion_tokens: 10, total_tokens: 110,
  });
  const deepseekPrice = adapterPrice("deepseek", "deepseek-flash");
  const peak = estimateCost({ providerId: "deepseek", modelId: deepseekPrice.modelId, usage: deepseekUsage, pricing: [deepseekPrice], at: "2026-10-05T02:00:00Z" });
  const offPeak = estimateCost({ providerId: "deepseek", modelId: deepseekPrice.modelId, usage: deepseekUsage, pricing: [deepseekPrice], at: "2026-10-04T02:00:00Z" });
  assert.equal(peak.amount, 0.00003612);
  assert.equal(offPeak.amount, 0.00001806);

  const grokPrice = adapterPrice("xai", "grok-4.7");
  const grok = estimateCost({
    providerId: "xai", modelId: grokPrice.modelId,
    usage: { inputTokens: 200_001, uncachedInputTokens: 200_001, outputTokens: 100, totalTokens: 200_101 },
    pricing: [grokPrice], at: "2026-10-06T12:00:00Z",
  });
  assert.equal(grok.amount, 0.800904);
});

test("Gemini date-based introductory rate expires at its published period boundary", () => {
  const row = adapterPrice("google", "gemini-3.8-flash");
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  const intro = estimateCost({ providerId: "google", modelId: row.modelId, usage, pricing: [row], at: "2026-12-31T23:59:00Z" });
  const standard = estimateCost({ providerId: "google", modelId: row.modelId, usage, pricing: [row], at: "2027-01-01T00:00:00Z" });
  assert.equal(intro.amount, 0.0000045);
  assert.equal(standard.amount, 0.000009);

  const cachedUsage = normalize("google", { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 10 });
  const cached = estimateCost({ providerId: "google", modelId: row.modelId, usage: cachedUsage, pricing: [row], at: "2026-10-06T12:00:00Z" });
  assert.equal(cached.amount, null);
  assert.match(cached.reason, /cached-input price/);
});

test("unknown cache prices and unlisted exact model IDs remain unpriced", () => {
  const usage = { inputTokens: 100, uncachedInputTokens: 90, cachedInputTokens: 10, outputTokens: 4, totalTokens: 104 };
  const noCacheRate = estimateCost({
    providerId: "custom-local", modelId: "m1", usage,
    pricing: { schemaVersion: 1, type: "model-pricing", providerId: "custom-local", modelId: "m1", currency: "USD", inputPerMillion: 1, outputPerMillion: 2 },
  });
  assert.equal(noCacheRate.amount, null);
  assert.match(noCacheRate.reason, /cached-input price/);
  assert.equal(estimateCost({ providerId: "openai", modelId: "gpt-6-luna-alias", usage, pricing: adapters.openai.pricing }).amount, null);
  assert.equal(estimateCost({ providerId: "deepseek", modelId: "deepseek-pro", usage, pricing: adapters.deepseek.pricing }).amount, null);
});

test("pricing imports require exact IDs, USD rates, and non-overlapping schedules", () => {
  const record = {
    schemaVersion: 1, type: "model-pricing", providerId: "custom-a", modelId: "model-1", currency: "USD",
    inputPerMillion: 1, outputPerMillion: 3,
  };
  assert.deepEqual(validatePricingImport(record), [record]);
  assert.throws(() => validatePricing({ ...record, modelId: "model-*" }), /exact model/);
  assert.throws(() => validatePricing({ ...record, currency: "EUR" }), /USD/);
  assert.throws(() => validatePricing({ ...record, inputPerMillion: -1 }), /nonnegative/);
  assert.throws(() => validatePricingImport([record, record]), /duplicate/);
  assert.throws(() => validatePricing({ ...record, longContextThreshold: 100, longContext: {} }), /at least one USD rate/);
  assert.throws(() => validatePricing({
    ...record,
    rateWindows: [
      { weekdaysUtc: [1], startMinuteUtc: 60, endMinuteUtc: 120, inputPerMillion: 2 },
      { weekdaysUtc: [1], startMinuteUtc: 90, endMinuteUtc: 150, inputPerMillion: 3 },
    ],
  }), /cannot overlap/);
  assert.throws(() => validatePricing({
    ...record,
    ratePeriods: [
      { validFrom: "2026-01-01", validThrough: "2026-02-01", inputPerMillion: 2 },
      { validFrom: "2026-02-01", validThrough: "2026-03-01", inputPerMillion: 3 },
    ],
  }), /cannot overlap/);

  const merged = mergePricing(adapters.openai.pricing, record);
  assert.equal(merged.find(row => row.providerId === "custom-a" && row.modelId === "model-1").inputPerMillion, 1);
  const replaced = mergePricing(merged, { ...record, inputPerMillion: 4 });
  assert.equal(replaced.find(row => row.providerId === "custom-a" && row.modelId === "model-1").inputPerMillion, 4);
});

test("xAI model metadata parser returns normalized exact pricing records", () => {
  const parsed = adapters.xai.api.parseModelsResponse({ payload: { models: [{
    id: "grok-enterprise",
    prompt_text_token_price: 20_000,
    cached_prompt_text_token_price: 5_000,
    completion_text_token_price: 60_000,
    long_context_threshold: 200_000,
    prompt_text_token_price_long_context: 40_000,
    cached_prompt_text_token_price_long_context: 10_000,
    completion_text_token_price_long_context: 90_000,
  }] } });
  const pricing = parsed.models[0].pricing;
  assert.equal(pricing.providerId, "xai");
  assert.equal(pricing.modelId, "grok-enterprise");
  assert.equal(pricing.inputPerMillion, 2);
  assert.equal(pricing.cachedInputPerMillion, 0.5);
  assert.equal(pricing.outputPerMillion, 6);
  assert.equal(pricing.longContextThreshold, 200_000);
  assert.deepEqual(pricing.longContext, { inputPerMillion: 4, cachedInputPerMillion: 1, outputPerMillion: 9 });
});

test("provider-reported cost is actual while estimates require an exact adapter or imported row", () => {
  assert.deepEqual(estimateCost({ providerId: "custom-a", modelId: "m", usage: { actualCostUsd: 0.1234567899 } }), {
    amount: 0.12345679, currency: "USD", estimated: false, source: "provider",
  });
  const unknown = estimateCost({ providerId: "openai", modelId: "gpt-6-luna-future-alias", usage: { inputTokens: 1, outputTokens: 1 }, pricing: adapters.openai.pricing });
  assert.equal(unknown.amount, null);
  assert.match(unknown.reason, /exact model/);
});
