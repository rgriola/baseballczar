// Last touched by agent: 2026-05-05T17:09:42Z
// Purpose: Benchmark route response times against a running local dev server.

import { performance } from 'node:perf_hooks';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_ROUTES = ['/', '/dashboard', '/sim-lab-2'];
const DEFAULT_RUNS = 5;

function readArg(name) {
  const prefix = `--${name}=`;
  const pair = process.argv.find((arg) => arg.startsWith(prefix));
  return pair ? pair.slice(prefix.length) : undefined;
}

function ensureRoutePath(route) {
  if (!route) return route;
  return route.startsWith('/') ? route : `/${route}`;
}

const baseUrl = readArg('baseUrl') ?? DEFAULT_BASE_URL;
const runsRaw = readArg('runs');
const runs = runsRaw ? Number(runsRaw) : DEFAULT_RUNS;
const routesRaw = readArg('routes');
const routes = (routesRaw ? routesRaw.split(',') : DEFAULT_ROUTES)
  .map((route) => ensureRoutePath(route.trim()))
  .filter(Boolean);

if (!Number.isFinite(runs) || runs < 1) {
  console.error('Invalid --runs value. Use a positive number.');
  process.exit(1);
}

if (!routes.length) {
  console.error('No routes provided.');
  process.exit(1);
}

async function timeRequest(route) {
  const url = new URL(route, baseUrl).toString();
  const started = performance.now();

  let status = 0;
  try {
    const response = await fetch(url, { redirect: 'manual' });
    status = response.status;
    await response.arrayBuffer();
  } catch {
    status = -1;
  }

  const ended = performance.now();
  return {
    status,
    ms: ended - started,
  };
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return { min, avg, max };
}

console.log(`Benchmarking ${routes.length} route(s), ${runs} run(s) each at ${baseUrl}`);

for (const route of routes) {
  const samples = [];
  const statuses = [];

  for (let index = 0; index < runs; index += 1) {
    const result = await timeRequest(route);
    samples.push(result.ms);
    statuses.push(result.status);
  }

  const stats = summarize(samples);
  const statusSummary = Array.from(new Set(statuses)).join(', ');

  console.log(
    `${route} -> status ${statusSummary}, min ${stats.min.toFixed(1)}ms, avg ${stats.avg.toFixed(1)}ms, max ${stats.max.toFixed(1)}ms`,
  );
}