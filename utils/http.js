// Shared HTTP / input helpers used by every controller.
const mongoose = require('mongoose');

// Error carrying an HTTP status. `extra` is merged into the JSON error body
// (e.g. { code: 'MIN_ORDER_VALUE', minOrderValue: 100 }).
class AppError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.expose = true;
    if (extra) this.extra = extra;
  }
}

const httpError = (status, message, extra) => new AppError(status, message, extra);

// Wrap an async route so rejections reach the central error handler.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Coerce an untrusted value (query/body) into a plain trimmed string.
// Objects (e.g. `{ $ne: null }`) become '' so they can never reach a Mongo filter.
const toStr = (v) => {
  if (Array.isArray(v)) v = v[0];
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};

// Comma list (or repeated query param) → array of non-empty strings.
const toList = (v) => {
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .flatMap((x) => (typeof x === 'string' ? x.split(',') : []))
    .map((x) => x.trim())
    .filter(Boolean);
};

const toNum = (v) => {
  const s = toStr(v);
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

const isValidId = (id) => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id);

// Pagination with a hard cap. Catalog reads pass maxLimit 1000, everything else 100.
const parsePagination = (query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page = Math.max(1, parseInt(toStr(query.page), 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(toStr(query.limit), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

const escapeHtml = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Await a best-effort side effect (email/push) but never longer than `ms`, and never throw.
// On serverless platforms un-awaited work can be frozen mid-flight once the response is sent.
const bestEffort = async (promiseOrFn, ms = 4000, label = 'task') => {
  let timer;
  try {
    const p = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
    return await Promise.race([
      Promise.resolve(p),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[bestEffort] ${label} timed out after ${ms}ms`);
          resolve(undefined);
        }, ms);
      }),
    ]);
  } catch (e) {
    console.error(`[bestEffort] ${label} failed:`, e?.message || e);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

// Resolve to `fallback` if the promise doesn't settle within `ms` (or rejects).
const withTimeout = async (promise, ms, fallback = null) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Recursively drop keys that start with `$` or contain `.` (Mongo operator injection).
const stripMongoOperators = (obj, depth = 0) => {
  if (!obj || typeof obj !== 'object' || depth > 10) return obj;
  if (Array.isArray(obj)) {
    obj.forEach((v) => stripMongoOperators(v, depth + 1));
    return obj;
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) delete obj[key];
    else stripMongoOperators(obj[key], depth + 1);
  }
  return obj;
};

// CSV cell: quote, escape quotes, and neutralise spreadsheet formula injection.
const csvCell = (v) => {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers, rows) =>
  [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');

const sendCsv = (res, filename, headers, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + toCsv(headers, rows));
};

module.exports = {
  AppError,
  httpError,
  asyncHandler,
  escapeRegex,
  toStr,
  toList,
  toNum,
  isValidId,
  parsePagination,
  escapeHtml,
  bestEffort,
  withTimeout,
  round2,
  stripMongoOperators,
  csvCell,
  toCsv,
  sendCsv,
};
