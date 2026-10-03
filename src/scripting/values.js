/** How Petto Code sees values: the truth of a value, how it prints, and how two values compare. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const typeOf = (value) => (value === null || value === undefined ? 'nil' : Array.isArray(value) ? 'list' : typeof value === 'object' ? 'map' : typeof value);

/** Like Go's templates: nil, false, 0, an empty text, list or map are false. */
function isTruthy(value) {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function toText(value, depth = 0) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e9) / 1e9);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (depth > 3) return '...';
  if (Array.isArray(value)) return `[${value.slice(0, 200).map((item) => toText(item, depth + 1)).join(' ')}]`;
  return `map[${Object.keys(value).slice(0, 200).map((key) => `${key}:${toText(value[key], depth + 1)}`).join(' ')}]`;
}

function equals(a, b) {
  const nilA = a === null || a === undefined;
  const nilB = b === null || b === undefined;
  if (nilA || nilB) return nilA && nilB;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, i) => equals(item, b[i]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equals(a[key], b[key]));
}

/** A number from a number or from a text that holds one, so the arguments of a command (always text) can be used in math. */
function toNumber(value, what = 'a number') {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  throw new Error(`Expected ${what}, got ${typeOf(value)}${typeof value === 'string' ? ` "${value.slice(0, 30)}"` : ''}`);
}

/** The own field of a map or list, or nil. Reading the inside of nil or of a plain value is a mistake. */
function readField(base, name) {
  if (base === null || base === undefined) throw new Error(`Cannot read .${name} of nil`);
  if (typeof base !== 'object') throw new Error(`Cannot read .${name} of ${typeOf(base)}`);
  if (FORBIDDEN_KEYS.has(name) || !Object.prototype.hasOwnProperty.call(base, name)) return null;
  const value = base[name];
  return value === undefined ? null : value;
}

module.exports = { FORBIDDEN_KEYS, typeOf, isTruthy, toText, equals, toNumber, readField };
