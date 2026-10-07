"use strict";

const { EFFORTS } = require("./ai-catalog.cjs");
const catalog = require("./ai-functions.json");
const groups = new Set(catalog.groups.map(row => row.id));
const functions = new Map(catalog.functions.map(row => [row.id, row]));
const plain = value => !!value && typeof value === "object" && !Array.isArray(value);

function emptyAssignments() {
  return { schemaVersion: 1, default: null, defaultDisabled: false, groups: {}, functions: {} };
}

function normalizeBinding(value, providerIds) {
  if (!plain(value) || typeof value.providerId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value.providerId)
    || providerIds && !providerIds.includes(value.providerId)
    || !["cli", "api"].includes(value.mode)
    || typeof value.model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value.model)
    || !EFFORTS.includes(value.effort)) return null;
  return { providerId: value.providerId, mode: value.mode, model: value.model, effort: value.effort };
}

function normalizeAssignments(value, providerIds) {
  const result = emptyAssignments();
  if (!plain(value) || value.schemaVersion !== 1) return result;
  result.default = normalizeBinding(value.default, providerIds);
  result.defaultDisabled = !result.default && value.defaultDisabled === true;
  for (const [scope, ids] of [["groups", groups], ["functions", functions]]) {
    if (!plain(value[scope])) continue;
    for (const [id, raw] of Object.entries(value[scope])) {
      if (!ids.has(id)) continue;
      if (raw === null) { result[scope][id] = null; continue; }
      const binding = normalizeBinding(raw, providerIds);
      if (binding) result[scope][id] = binding;
    }
  }
  return result;
}

function assignmentTarget(payload) {
  if (payload?.scope === "default") return { scope: "default" };
  if (payload?.scope === "group" && groups.has(payload.id)) return { scope: "group", id: payload.id };
  if (payload?.scope === "function" && functions.has(payload.id)) return { scope: "function", id: payload.id };
  throw new Error("AI 기능 또는 설정 그룹을 확인하세요.");
}

function saveAssignment(assignments, payload, binding) {
  const target = assignmentTarget(payload);
  const result = normalizeAssignments(assignments);
  if (target.scope === "default") {
    result.default = binding ? { ...binding } : null;
    result.defaultDisabled = binding === null;
    if (payload.resetOverrides === true) { result.groups = {}; result.functions = {}; }
  } else if (target.scope === "group") {
    result.groups[target.id] = binding ? { ...binding } : null;
    if (payload.resetOverrides === true) {
      for (const row of functions.values()) if (row.groupId === target.id) delete result.functions[row.id];
    }
  } else result.functions[target.id] = binding ? { ...binding } : null;
  return result;
}

function clearAssignment(assignments, payload) {
  const target = assignmentTarget(payload);
  const result = normalizeAssignments(assignments);
  if (target.scope === "default") { result.default = null; result.defaultDisabled = false; }
  else delete result[target.scope === "group" ? "groups" : "functions"][target.id];
  return result;
}

function resolveAssignment(assignments, functionId) {
  const feature = functions.get(functionId);
  if (!feature) throw new Error("지원하지 않는 AI 기능입니다.");
  const individual = Object.hasOwn(assignments?.functions || {}, functionId);
  const local = assignments?.functions?.[functionId];
  const group = assignments?.groups?.[feature.groupId];
  const grouped = Object.hasOwn(assignments?.groups || {}, feature.groupId);
  const binding = individual ? local : grouped ? group : assignments?.default || null;
  return { binding: binding ? { ...binding } : null, source: individual ? "function" : grouped ? "group" : binding || assignments?.defaultDisabled ? "default" : "none" };
}

function setFunctionInheritance(assignments, functionId, followGroup) {
  assignmentTarget({ scope: "function", id: functionId });
  if (typeof followGroup !== "boolean") throw new Error("그룹 설정 적용 여부를 확인하세요.");
  const result = normalizeAssignments(assignments);
  if (followGroup) delete result.functions[functionId];
  else if (!Object.hasOwn(result.functions, functionId)) result.functions[functionId] = resolveAssignment(result, functionId).binding;
  return result;
}

module.exports = { catalog, emptyAssignments, normalizeBinding, normalizeAssignments, assignmentTarget, saveAssignment, clearAssignment, resolveAssignment, setFunctionInheritance };
