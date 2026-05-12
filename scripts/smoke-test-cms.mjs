#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://creare-cms-production.up.railway.app';
const DEFAULT_TIMEOUT_MS = 8000;

const baseUrl = (process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const timeoutMs = Number.parseInt(process.env.SMOKE_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10);

const routes = [
  '/api/health',
  '/api/ready',
  '/api/experiences?pagination[pageSize]=1',
  '/api/destinations?pagination[pageSize]=1',
  '/api/insights?pagination[pageSize]=1',
];

const results = [];

async function checkRoute(route) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}${route}`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    const durationMs = Date.now() - startedAt;
    const passed = response.status >= 200 && response.status < 400;

    return {
      route,
      status: response.status,
      durationMs,
      passed,
      error: passed ? null : `Unexpected HTTP ${response.status}`,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const isAbort = error instanceof Error && error.name === 'AbortError';

    return {
      route,
      status: 'ERR',
      durationMs,
      passed: false,
      error: isAbort ? `Timed out after ${timeoutMs}ms` : error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`CREARE CMS smoke test`);
console.log(`Base URL: ${baseUrl}`);
console.log(`Timeout: ${timeoutMs}ms`);
console.log('');

for (const route of routes) {
  const result = await checkRoute(route);
  results.push(result);

  const label = result.passed ? 'PASS' : 'FAIL';
  const status = result.status;
  const suffix = result.error ? ` ${result.error}` : '';

  console.log(`[${label}] ${route} ${status} ${result.durationMs}ms${suffix}`);
}

const failed = results.filter((result) => !result.passed);

console.log('');
console.log(
  failed.length === 0
    ? `All ${results.length} checks passed.`
    : `${failed.length} of ${results.length} checks failed.`
);

if (failed.length > 0) {
  process.exitCode = 1;
}
