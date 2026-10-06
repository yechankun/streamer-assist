const PRICING_SCHEMA_VERSION = 1;
const MILLION = 1_000_000;

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function checkedRate(value, name, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000)
    throw new Error(`Pricing field ${name} must be a finite nonnegative USD rate per million tokens.`);
  return value;
}

function checkedDate(value, name, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)))
    throw new Error(`Pricing field ${name} must be an ISO date (YYYY-MM-DD).`);
  return value;
}

function copyRates(source, target, { optional = false } = {}) {
  for (const key of ["inputPerMillion", "outputPerMillion", "cachedInputPerMillion", "cacheWriteInputPerMillion", "cacheWrite5mInputPerMillion", "cacheWrite1hInputPerMillion"]) {
    const value = checkedRate(source[key], key, optional || key.startsWith("cached") || key.startsWith("cacheWrite"));
    if (value !== undefined) target[key] = value;
  }
  if (!optional && (target.inputPerMillion === undefined || target.outputPerMillion === undefined))
    throw new Error("Pricing must include inputPerMillion and outputPerMillion.");
  if (optional && !Object.keys(target).some(key => key.endsWith("PerMillion")))
    throw new Error("A nested pricing schedule must include at least one USD rate.");
}

function validatePricing(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schemaVersion !== PRICING_SCHEMA_VERSION || input.type !== "model-pricing")
    throw new Error("Unsupported pricing file; expected schemaVersion 1 and type model-pricing.");
  if (typeof input.providerId !== "string" || !/^(?:[a-z0-9][a-z0-9-]{0,39})$/.test(input.providerId))
    throw new Error("Pricing providerId is invalid.");
  if (typeof input.modelId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(input.modelId))
    throw new Error("Pricing modelId must name one exact model.");
  if (input.currency !== "USD") throw new Error("Only USD pricing records are supported.");

  const record = {
    schemaVersion: PRICING_SCHEMA_VERSION,
    type: "model-pricing",
    providerId: input.providerId,
    modelId: input.modelId,
    currency: "USD",
  };
  copyRates(input, record);
  for (const key of ["longContextThreshold"]) {
    if (input[key] !== undefined) {
      if (!Number.isSafeInteger(input[key]) || input[key] < 1 || input[key] > 10_000_000)
        throw new Error(`Pricing field ${key} is invalid.`);
      record[key] = input[key];
    }
  }
  if (input.longContext !== undefined) {
    if (!record.longContextThreshold || !input.longContext || typeof input.longContext !== "object" || Array.isArray(input.longContext))
      throw new Error("longContext requires a longContextThreshold.");
    const rates = {};
    copyRates(input.longContext, rates, { optional: true });
    record.longContext = rates;
  }

  if (input.rateWindows !== undefined) {
    if (!Array.isArray(input.rateWindows) || input.rateWindows.length > 64)
      throw new Error("Pricing rateWindows must be an array with at most 64 entries.");
    record.rateWindows = input.rateWindows.map(window => {
      if (!window || typeof window !== "object" || Array.isArray(window) || !Array.isArray(window.weekdaysUtc) || !window.weekdaysUtc.length || window.weekdaysUtc.some(day => !Number.isInteger(day) || day < 0 || day > 6))
        throw new Error("A rate window needs UTC weekdays from 0 through 6.");
      if (!Number.isInteger(window.startMinuteUtc) || !Number.isInteger(window.endMinuteUtc) || window.startMinuteUtc < 0 || window.endMinuteUtc > 1440 || window.startMinuteUtc >= window.endMinuteUtc)
        throw new Error("A rate window needs valid UTC start and end minutes.");
      const normalized = {
        weekdaysUtc: [...new Set(window.weekdaysUtc)],
        startMinuteUtc: window.startMinuteUtc,
        endMinuteUtc: window.endMinuteUtc,
      };
      copyRates(window, normalized, { optional: true });
      return normalized;
    });
    for (let left = 0; left < record.rateWindows.length; left++) {
      for (let right = left + 1; right < record.rateWindows.length; right++) {
        const a = record.rateWindows[left];
        const b = record.rateWindows[right];
        const sharesDay = a.weekdaysUtc.some(day => b.weekdaysUtc.includes(day));
        const overlaps = a.startMinuteUtc < b.endMinuteUtc && b.startMinuteUtc < a.endMinuteUtc;
        if (sharesDay && overlaps) throw new Error("Pricing rate windows cannot overlap.");
      }
    }
  }

  if (input.ratePeriods !== undefined) {
    if (!Array.isArray(input.ratePeriods) || !input.ratePeriods.length || input.ratePeriods.length > 32)
      throw new Error("Pricing ratePeriods must contain between 1 and 32 entries.");
    record.ratePeriods = input.ratePeriods.map(period => {
      if (!period || typeof period !== "object" || Array.isArray(period)) throw new Error("A pricing rate period must be an object.");
      const normalized = {};
      if (period.validFrom !== undefined) normalized.validFrom = checkedDate(period.validFrom, "validFrom");
      if (period.validThrough !== undefined) normalized.validThrough = checkedDate(period.validThrough, "validThrough");
      if (normalized.validFrom && normalized.validThrough && normalized.validFrom > normalized.validThrough)
        throw new Error("Pricing rate period dates are reversed.");
      copyRates(period, normalized, { optional: true });
      return normalized;
    });
    for (let left = 0; left < record.ratePeriods.length; left++) {
      for (let right = left + 1; right < record.ratePeriods.length; right++) {
        const a = record.ratePeriods[left];
        const b = record.ratePeriods[right];
        const aEnd = a.validThrough || "9999-12-31";
        const bEnd = b.validThrough || "9999-12-31";
        const aStart = a.validFrom || "0000-01-01";
        const bStart = b.validFrom || "0000-01-01";
        if (aStart <= bEnd && bStart <= aEnd) throw new Error("Pricing rate periods cannot overlap.");
      }
    }
  }

  if (input.validFrom !== undefined) record.validFrom = checkedDate(input.validFrom, "validFrom");
  if (input.validThrough !== undefined) record.validThrough = checkedDate(input.validThrough, "validThrough");
  if (record.validFrom && record.validThrough && record.validFrom > record.validThrough)
    throw new Error("Pricing validity dates are reversed.");
  if (input.source !== undefined) {
    if (typeof input.source !== "string" || input.source.length > 500) throw new Error("Pricing source is invalid.");
    let source;
    try { source = new URL(input.source); } catch { throw new Error("Pricing source must be an HTTPS URL."); }
    if (source.protocol !== "https:" || source.username || source.password) throw new Error("Pricing source must be an HTTPS URL.");
    record.source = source.href;
  }
  if (input.checkedAt !== undefined) record.checkedAt = checkedDate(input.checkedAt, "checkedAt");
  return record;
}

function validatePricingImport(input) {
  const rows = Array.isArray(input) ? input : [input];
  if (!rows.length || rows.length > 1000) throw new Error("A pricing import must contain 1 to 1000 model records.");
  const records = rows.map(validatePricing);
  const keys = new Set();
  for (const record of records) {
    const key = `${record.providerId}\0${record.modelId}`;
    if (keys.has(key)) throw new Error("A pricing import cannot contain duplicate provider/model IDs.");
    keys.add(key);
  }
  return records;
}

function pricingList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(row => Array.isArray(row) ? row : [row]).map(validatePricing);
  return [validatePricing(value)];
}

function mergePricing(existing, incoming) {
  const rows = [...pricingList(existing)];
  const updated = pricingList(incoming);
  const map = new Map(rows.map(row => [`${row.providerId}\0${row.modelId}`, row]));
  for (const record of updated) map.set(`${record.providerId}\0${record.modelId}`, record);
  return [...map.values()];
}

function exactPricing(providerId, modelId, pricing) {
  const rows = pricingList(pricing);
  return rows.find(row => row.providerId === providerId && row.modelId === modelId);
}

function roundCost(amount) {
  if (!Number.isFinite(amount)) return null;
  if (Math.abs(amount) < 1_000_000) return Math.round(amount * 1_000_000_000) / 1_000_000_000;
  return Number(amount.toPrecision(15));
}

function rateFor(pricing, at, usage) {
  const date = at instanceof Date ? at : new Date(at || Date.now());
  if (!Number.isFinite(date.getTime())) return undefined;
  const day = date.getUTCDay();
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  const asDate = date.toISOString().slice(0, 10);

  let result = { ...pricing };
  if (pricing.ratePeriods?.length) {
    const period = pricing.ratePeriods.find(candidate => (!candidate.validFrom || asDate >= candidate.validFrom) && (!candidate.validThrough || asDate <= candidate.validThrough));
    if (!period) return undefined;
    result = { ...result, ...period };
  }
  if ((pricing.validFrom && asDate < pricing.validFrom) || (pricing.validThrough && asDate > pricing.validThrough)) return undefined;

  if (pricing.rateWindows?.length) {
    const window = pricing.rateWindows.find(candidate => candidate.weekdaysUtc.includes(day) && minute >= candidate.startMinuteUtc && minute < candidate.endMinuteUtc);
    if (window) result = { ...result, ...window };
  }
  if (pricing.longContextThreshold && usage.inputTokens > pricing.longContextThreshold && pricing.longContext)
    result = { ...result, ...pricing.longContext };
  return result;
}

function estimateCost({ providerId, modelId, usage, pricing, at, actualCostUsd } = {}) {
  const actual = actualCostUsd ?? usage?.actualCostUsd;
  if (typeof actual === "number" && Number.isFinite(actual) && actual >= 0)
    return { amount: roundCost(actual), currency: "USD", estimated: false, source: "provider" };

  let record;
  try {
    record = exactPricing(providerId, modelId, pricing);
  } catch {
    return { amount: null, currency: "USD", estimated: true, reason: "The configured model price is invalid." };
  }
  if (!record) return { amount: null, currency: "USD", estimated: true, reason: "No USD price is configured for this exact model." };
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "Provider token usage is incomplete." };
  if (usage.inputBreakdownValid === false)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "Provider cache token counts are inconsistent." };

  const rates = rateFor(record, at, usage);
  if (!rates)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "No verified price applies at this time." };
  const cached = usage.cachedInputTokens || 0;
  const write5m = usage.cacheWrite5mInputTokens || 0;
  const write1h = usage.cacheWrite1hInputTokens || 0;
  const genericWrite = usage.cacheWriteInputTokens || 0;
  const detailedWrites = write5m + write1h;
  const allWrites = Math.max(genericWrite, detailedWrites);
  if (cached + allWrites > usage.inputTokens)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "Provider cache token counts are inconsistent." };
  if (cached && rates.cachedInputPerMillion === undefined)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "The cached-input price is not available." };
  if (write5m && rates.cacheWrite5mInputPerMillion === undefined && rates.cacheWriteInputPerMillion === undefined)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "The 5-minute cache-write price is not available." };
  if (write1h && rates.cacheWrite1hInputPerMillion === undefined && rates.cacheWriteInputPerMillion === undefined)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "The 1-hour cache-write price is not available." };
  if (genericWrite > detailedWrites && rates.cacheWriteInputPerMillion === undefined)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "The cache-write price is not available." };

  const uncached = usage.inputTokens - cached - allWrites;
  let inputCost = uncached * rates.inputPerMillion / MILLION;
  if (cached) inputCost += cached * rates.cachedInputPerMillion / MILLION;
  if (write5m) inputCost += write5m * (rates.cacheWrite5mInputPerMillion ?? rates.cacheWriteInputPerMillion) / MILLION;
  if (write1h) inputCost += write1h * (rates.cacheWrite1hInputPerMillion ?? rates.cacheWriteInputPerMillion) / MILLION;
  if (genericWrite > detailedWrites) inputCost += (genericWrite - detailedWrites) * rates.cacheWriteInputPerMillion / MILLION;
  const outputCost = usage.outputTokens * rates.outputPerMillion / MILLION;
  const amount = roundCost(inputCost + outputCost);
  if (amount === null)
    return { amount: null, currency: "USD", estimated: true, source: record.source, checkedAt: record.checkedAt, reason: "The estimated price exceeded the supported numeric range." };
  return {
    amount,
    currency: "USD",
    estimated: true,
    source: record.source,
    checkedAt: record.checkedAt,
    breakdown: { input: roundCost(inputCost), output: roundCost(outputCost) },
  };
}

function getPricing(providerId, modelId, extraPricing) {
  return exactPricing(providerId, modelId, extraPricing);
}

module.exports = {
  PRICING_SCHEMA_VERSION,
  validatePricing,
  validatePricingImport,
  mergePricing,
  estimateCost,
  getPricing,
};
