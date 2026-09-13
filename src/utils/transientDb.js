const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error.message ?? error.details ?? error.hint ?? error.code ?? error);
}

function errorStatus(error) {
  const value = Number(error?.status ?? error?.statusCode ?? error?.code);
  return Number.isFinite(value) ? value : null;
}

function isTransientDbError(error) {
  const status = errorStatus(error);
  if (status && TRANSIENT_STATUS_CODES.has(status)) return true;

  const message = errorMessage(error).toLowerCase();
  return /gateway timeout|bad gateway|service unavailable|temporar(?:y|ily) unavailable|timeout|timed out|fetch failed|network error|econnreset|etimedout|socket hang up|connection reset/.test(message);
}

function retryDelayMs(attempt) {
  return [200, 600, 1_200, 2_000][attempt] ?? 2_000;
}

async function retryIdempotent(operation, { attempts = 3, onRetry = null } = {}) {
  let lastError = null;
  const maxAttempts = Math.max(1, Number(attempts) || 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= maxAttempts - 1) throw error;
      const delay = retryDelayMs(attempt);
      onRetry?.(error, attempt + 1, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

module.exports = {
  TRANSIENT_STATUS_CODES,
  sleep,
  isTransientDbError,
  retryDelayMs,
  retryIdempotent,
};
