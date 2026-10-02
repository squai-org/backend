import { setTimeout } from 'node:timers/promises';

const transientStatuses = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const transientNetworkCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function retryAfter(response) {
  const value = response.headers.get('Retry-After');
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

export async function runSmokeChecks(
  checks,
  {
    expectedVersion = null,
    fetchFn = fetch,
    clock = () => performance.now(),
    sleep = (delay) => setTimeout(delay),
    random = Math.random,
    log = (entry) => console.log(JSON.stringify(entry)),
    maxAttempts = 4,
    timeoutMs = 10000,
    budgetMs = 90000,
    assetWindowMs = 30000,
  } = {},
) {
  const started = clock();
  const results = [];
  let readinessFailed = false;
  for (const check of checks) {
    const attempts = [];
    const result = {
      check: check.id,
      method: check.method,
      url: check.url,
      expectedStatus: check.expectedStatus,
      outcome: 'failed',
      attempts,
    };
    results.push(result);
    if (readinessFailed || clock() - started >= budgetMs) {
      result.outcome = 'skipped';
      result.reason = readinessFailed ? 'READINESS_FAILED' : 'BUDGET_EXHAUSTED';
      continue;
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remaining = budgetMs - (clock() - started);
      if (remaining <= 0) {
        result.reason = 'BUDGET_EXHAUSTED';
        break;
      }
      const signal = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(timeoutMs, remaining))));
      const attemptStarted = clock();
      const entry = {
        check: check.id,
        method: check.method,
        url: check.url,
        expectedStatus: check.expectedStatus,
        attempt,
        status: null,
        requestId: null,
        cfRay: null,
        contentType: null,
        actualVersion: null,
        error: null,
      };
      let retryable = false;
      let minimumDelay = 0;
      let response;
      try {
        response = await fetchFn(check.url, { method: check.method, redirect: 'manual', signal });
        entry.status = response.status;
        entry.requestId = response.headers.get('X-Request-Id');
        entry.cfRay = response.headers.get('CF-Ray');
        entry.contentType = response.headers.get('Content-Type');
        entry.actualVersion = response.headers.get('X-Deployment-Version');
        if (response.status !== check.expectedStatus) {
          entry.error = 'HTTP_STATUS';
          retryable =
            transientStatuses.has(response.status) ||
            (check.retryMissingAsset &&
              response.status === 404 &&
              clock() - started < assetWindowMs);
          if (response.status === 429 || response.status === 503)
            minimumDelay = retryAfter(response);
        } else if (expectedVersion && entry.actualVersion !== expectedVersion) {
          entry.error = 'VERSION_MISMATCH';
          retryable = true;
        } else {
          entry.error = await check.validate(response);
        }
      } catch (error) {
        const code = error.cause?.code ?? error.code;
        entry.networkCode =
          typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
        entry.error =
          signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError'
            ? 'TIMEOUT'
            : 'NETWORK_ERROR';
        retryable = entry.error === 'TIMEOUT' || transientNetworkCodes.has(entry.networkCode);
      } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
      entry.durationMs = Math.round(clock() - attemptStarted);
      attempts.push(entry);
      log(entry);
      if (!entry.error) {
        result.outcome = attempt === 1 ? 'passed' : 'recovered';
        delete result.reason;
        break;
      }
      result.reason = entry.error;
      if (!retryable || attempt === maxAttempts) break;
      const delay = Math.max(minimumDelay, 1000 * 2 ** (attempt - 1) * (0.75 + random() * 0.5));
      if (
        clock() - started + delay >= budgetMs ||
        (check.retryMissingAsset &&
          entry.status === 404 &&
          clock() - started + delay >= assetWindowMs)
      )
        break;
      await sleep(delay);
    }
    if (check.readiness && !['passed', 'recovered'].includes(result.outcome))
      readinessFailed = true;
  }
  return {
    expectedVersion,
    durationMs: Math.round(clock() - started),
    passed: results.every((result) => ['passed', 'recovered'].includes(result.outcome)),
    results,
  };
}
