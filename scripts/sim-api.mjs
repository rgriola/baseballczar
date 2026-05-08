#!/usr/bin/env node
// Last touched by agent: 2026-05-06T16:42:55Z
// Purpose: Call local sim API endpoints from root npm scripts for testing.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const command = process.argv[2] ?? '';
const args = process.argv.slice(3);

const endpointByCommand = {
  'run-due': '/api/sim/run-due',
  'sim-all': '/api/sim/sim-all',
  reset: '/api/sim/reset',
  run: '/api/sim/run',
  summary: '/api/sim/summary',
};

function readArg(name) {
  const inlinePrefix = `--${name}=`;
  const inlineArg = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inlineArg) return inlineArg.slice(inlinePrefix.length);

  const idx = args.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}. Expected a positive integer.`);
  }
  return parsed;
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvFile(filePath) {
  const out = new Map();
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = stripQuotes(line.slice(eq + 1).trim());
    out.set(key, value);
  }
  return out;
}

function readEnvVar(name) {
  if (process.env[name]) return process.env[name];

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '.env.local'),
    path.join(cwd, 'apps', 'web', '.env.local'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const envMap = parseEnvFile(candidate);
    const value = envMap.get(name);
    if (value) return value;
  }

  return undefined;
}

function printUsage() {
  console.error(
    'Usage: node scripts/sim-api.mjs <run-due|sim-all|run|reset|summary|sim-league> '
    + '[--scheduleId <id>|--scheduled <id>] [--leagueId <id>] [--seasonNo <n>] '
    + '[--batchSize <n>] [--loop] [--queue] [--inline] [--wait] [--no-summary] [--reset] [--baseUrl <url>]',
  );
}

function asFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatPct(value, digits = 1) {
  return `${(asFiniteNumber(value) * 100).toFixed(digits)}%`;
}

function printSmokeSummary(summary) {
  if (!summary || typeof summary !== 'object') return;

  const rates = summary.rates ?? {};
  const perTeam = summary.perTeamGame ?? {};
  const spray = summary.spray ?? {};
  const launch = summary.launch ?? {};
  const scope = summary.scope ?? {};

  const scopeParts = [];
  if (scope.leagueId != null) scopeParts.push(`leagueId=${scope.leagueId}`);
  if (scope.seasonNo != null) scopeParts.push(`seasonNo=${scope.seasonNo}`);

  console.log('\nSmoke Summary' + (scopeParts.length > 0 ? ` (${scopeParts.join(', ')})` : ''));

  console.log('\nRates');
  console.log(
    `  Games: ${asFiniteNumber(summary.games).toFixed(0)}   `
    + `PA: ${asFiniteNumber(rates.plateAppearances).toFixed(0)}   `
    + `AB: ${asFiniteNumber(rates.atBats).toFixed(0)}   `
    + `H: ${asFiniteNumber(rates.hits).toFixed(0)}   `
    + `HR: ${asFiniteNumber(rates.homeRuns).toFixed(0)}   `
    + `BB: ${asFiniteNumber(rates.walks).toFixed(0)}   `
    + `K: ${asFiniteNumber(rates.strikeouts).toFixed(0)}`,
  );
  console.log(
    `  BB%: ${formatPct(rates.bbPct)}   `
    + `K%: ${formatPct(rates.kPct)}   `
    + `BABIP: ${asFiniteNumber(rates.babip).toFixed(3)}   `
    + `HR/FB(est): ${asFiniteNumber(rates.hrPerFb).toFixed(3)}`,
  );

  console.log('\nPer-Team-Game');
  console.log(
    `  R: ${asFiniteNumber(perTeam.runs).toFixed(2)}   `
    + `H: ${asFiniteNumber(perTeam.hits).toFixed(2)}   `
    + `2B: ${asFiniteNumber(perTeam.doubles).toFixed(2)}   `
    + `3B: ${asFiniteNumber(perTeam.triples).toFixed(2)}   `
    + `HR: ${asFiniteNumber(perTeam.homeRuns).toFixed(2)}`,
  );

  const sprayTotal = asFiniteNumber(spray.total);
  const sprayFair = asFiniteNumber(spray.fair);
  const sprayFoul = asFiniteNumber(spray.foul);
  console.log('\nSpray-Angle Distribution');
  console.log(
    `  total=${sprayTotal.toFixed(0)}   fair=${sprayFair.toFixed(0)} (${formatPct(sprayFair / Math.max(1, sprayTotal))})   `
    + `foul=${sprayFoul.toFixed(0)} (${formatPct(sprayFoul / Math.max(1, sprayTotal))})`,
  );
  console.log(
    `  mean spray=${asFiniteNumber(spray.meanDeg).toFixed(1)}deg   `
    + `mean |spray|=${asFiniteNumber(spray.meanAbsDeg).toFixed(1)}deg`,
  );
  console.log('  bucket                       fair    foul');
  for (const bucket of Array.isArray(spray.buckets) ? spray.buckets : []) {
    const label = String(bucket?.label ?? '').padEnd(26);
    const fair = asFiniteNumber(bucket?.fair).toFixed(0).padStart(5);
    const foul = asFiniteNumber(bucket?.foul).toFixed(0).padStart(5);
    const fairPct = formatPct(asFiniteNumber(bucket?.fair) / Math.max(1, sprayTotal));
    const foulPct = formatPct(asFiniteNumber(bucket?.foul) / Math.max(1, sprayTotal));
    console.log(`  ${label} ${fair} (${fairPct.padStart(6)})  ${foul} (${foulPct.padStart(6)})`);
  }

  const launchTotal = asFiniteNumber(launch.total);
  console.log('\nLaunch-Angle Distribution');
  console.log(
    `  total=${launchTotal.toFixed(0)}   `
    + `grounders=${asFiniteNumber(launch.grounders).toFixed(0)} (${formatPct(asFiniteNumber(launch.grounders) / Math.max(1, launchTotal))})   `
    + `fly/pop=${asFiniteNumber(launch.flyPop).toFixed(0)} (${formatPct(asFiniteNumber(launch.flyPop) / Math.max(1, launchTotal))})`,
  );
  console.log(
    `  mean LA=${asFiniteNumber(launch.meanDeg).toFixed(1)}deg   `
    + `mean |LA|=${asFiniteNumber(launch.meanAbsDeg).toFixed(1)}deg`,
  );
  console.log('  bucket                       count    pct');
  for (const bucket of Array.isArray(launch.buckets) ? launch.buckets : []) {
    const label = String(bucket?.label ?? '').padEnd(26);
    const count = asFiniteNumber(bucket?.count).toFixed(0).padStart(5);
    const pct = formatPct(asFiniteNumber(bucket?.count) / Math.max(1, launchTotal));
    console.log(`  ${label} ${count} (${pct.padStart(6)})`);
  }

  if (Array.isArray(summary.notes) && summary.notes.length > 0) {
    console.log('\nNotes');
    for (const note of summary.notes) {
      console.log(`  - ${String(note)}`);
    }
  }
}

async function postApi({ baseUrl, endpoint, serviceRoleKey, body, quiet = false }) {
  let response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const cause =
      error && typeof error === 'object' && 'cause' in error
        ? error.cause
        : undefined;
    const causeText =
      cause && typeof cause === 'object' && 'message' in cause
        ? String(cause.message)
        : cause
          ? String(cause)
          : 'unknown network error';

    throw new Error(
      `Request to ${baseUrl}${endpoint} failed before response. `
      + `Cause: ${causeText}. If sim-all was already accepted, the server may still be processing in the background.`,
    );
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  if (!quiet) {
    console.log(`POST ${endpoint} -> ${response.status}`);
    if (typeof payload === 'string') {
      console.log(payload);
    } else if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.summary) {
      const { summary, ...rest } = payload;
      console.log(JSON.stringify(rest, null, 2));
      printSmokeSummary(summary);
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
  }

  if (!response.ok) {
    process.exit(1);
  }

  return payload;
}

function buildSimAllBody({ leagueId, seasonNo, maxGames, includeSummary, mode }) {
  return {
    ...(mode ? { mode } : {}),
    ...(leagueId ? { leagueId } : {}),
    ...(seasonNo ? { seasonNo } : {}),
    ...(maxGames ? { maxGames } : {}),
    ...(includeSummary === false ? { includeSummary: false } : {}),
  };
}

function readBooleanFlag(name, defaultValue = false) {
  if (hasFlag(name)) return true;
  const explicit = readArg(name);
  if (!explicit) return defaultValue;
  const normalized = explicit.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObjectPayload(payload, errorMessage) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(errorMessage);
  }
  return payload;
}

async function fetchSmokeSummary({ baseUrl, serviceRoleKey, leagueId, seasonNo }) {
  await postApi({
    baseUrl,
    endpoint: '/api/sim/summary',
    serviceRoleKey,
    body: {
      ...(leagueId ? { leagueId } : {}),
      ...(seasonNo ? { seasonNo } : {}),
    },
  });
}

async function waitForQueuedJobs({ baseUrl, serviceRoleKey, jobIds, pollMs = 2000 }) {
  if (jobIds.length === 0) {
    return {
      done: true,
      pending: 0,
      counts: { completed: 0, failed: 0 },
      failed: [],
    };
  }

  let pollCount = 0;
  while (true) {
    pollCount += 1;
    const payload = asObjectPayload(
      await postApi({
        baseUrl,
        endpoint: '/api/sim/status/batch',
        serviceRoleKey,
        body: { jobIds },
        quiet: true,
      }),
      'Unexpected status-batch response payload.',
    );

    const pending = asFiniteNumber(payload.pending);
    const completed = asFiniteNumber(payload.counts?.completed);
    const failed = asFiniteNumber(payload.counts?.failed);

    if (pollCount % 3 === 1 || pending === 0) {
      console.log(`  queue wait: pending=${pending.toFixed(0)} completed=${completed.toFixed(0)} failed=${failed.toFixed(0)}`);
    }

    if (payload.done) {
      return payload;
    }

    if (pollCount >= 1800) {
      throw new Error('Timed out while waiting for queued simulation jobs to complete.');
    }

    await sleep(pollMs);
  }
}

async function runQueuedSimInBatches({
  baseUrl,
  serviceRoleKey,
  leagueId,
  seasonNo,
  batchSize,
  showFinalSummary,
}) {
  let batch = 0;
  let totalEnqueued = 0;
  let totalCompleted = 0;
  let totalFailed = 0;

  while (true) {
    batch += 1;
    const payload = asObjectPayload(
      await postApi({
        baseUrl,
        endpoint: '/api/sim/sim-all',
        serviceRoleKey,
        body: buildSimAllBody({
          mode: 'queue',
          leagueId,
          seasonNo,
          maxGames: batchSize,
          includeSummary: false,
        }),
      }),
      'Unexpected queue-mode sim-all response payload.',
    );

    const enqueued = asFiniteNumber(payload.enqueued);
    const remainingBefore = asFiniteNumber(payload.remainingBefore);
    const hasMore = Boolean(payload.hasMore);
    const jobIds = Array.isArray(payload.queueJobIds)
      ? payload.queueJobIds.map((id) => String(id))
      : [];

    if (enqueued === 0) {
      console.log(
        `Queue batch ${batch}: no jobs enqueued `
        + `(remainingBefore=${remainingBefore.toFixed(0)}, hasMore=${String(hasMore)}).`,
      );
      break;
    }

    totalEnqueued += enqueued;
    console.log(`Queue batch ${batch}: enqueued=${enqueued.toFixed(0)} jobs`);

    const status = asObjectPayload(
      await waitForQueuedJobs({ baseUrl, serviceRoleKey, jobIds }),
      'Unexpected status payload while waiting for queue jobs.',
    );

    const completed = asFiniteNumber(status.counts?.completed);
    const failed = asFiniteNumber(status.counts?.failed);
    totalCompleted += completed;
    totalFailed += failed;

    if (Array.isArray(status.failed) && status.failed.length > 0) {
      const sample = status.failed.slice(0, 3);
      for (const row of sample) {
        console.log(`  failed job ${String(row.jobId)}: ${String(row.reason)}`);
      }
      if (status.failed.length > sample.length) {
        console.log(`  ... ${status.failed.length - sample.length} more failed jobs`);
      }
    }

    console.log(`Queue batch ${batch} complete: completed=${completed.toFixed(0)} failed=${failed.toFixed(0)}`);

    if (!hasMore && remainingBefore <= enqueued) {
      // Likely drained; next pass would be a no-op, so stop here.
      break;
    }
  }

  console.log(
    `Queued simulation complete: enqueued=${totalEnqueued.toFixed(0)} `
    + `completed=${totalCompleted.toFixed(0)} failed=${totalFailed.toFixed(0)} batches=${batch}`,
  );

  if (showFinalSummary) {
    await fetchSmokeSummary({ baseUrl, serviceRoleKey, leagueId, seasonNo });
  }
}

async function runSimAllInBatches({
  baseUrl,
  serviceRoleKey,
  leagueId,
  seasonNo,
  batchSize,
  showFinalSummary,
}) {
  let batch = 0;
  let totalSimulated = 0;
  let totalFailed = 0;

  while (true) {
    batch += 1;
    const payload = await postApi({
      baseUrl,
      endpoint: '/api/sim/sim-all',
      serviceRoleKey,
      body: buildSimAllBody({
        mode: 'inline',
        leagueId,
        seasonNo,
        maxGames: batchSize,
        includeSummary: false,
      }),
    });

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Unexpected sim-all response payload while looping batches.');
    }

    const simulatedThisBatch = asFiniteNumber(payload.simulated);
    const failedThisBatch = asFiniteNumber(payload.failed);
    const remainingAfter = asFiniteNumber(payload.remainingAfter);
    const hasMore = Boolean(payload.hasMore);

    totalSimulated += simulatedThisBatch;
    totalFailed += failedThisBatch;

    console.log(
      `Batch ${batch}: simulated=${simulatedThisBatch.toFixed(0)} `
      + `failed=${failedThisBatch.toFixed(0)} remaining=${remainingAfter.toFixed(0)}`,
    );

    if (!hasMore) break;
  }

  console.log(
    `Batched sim-all complete: simulated=${totalSimulated.toFixed(0)} `
    + `failed=${totalFailed.toFixed(0)} batches=${batch}`,
  );

  if (showFinalSummary) {
    await fetchSmokeSummary({ baseUrl, serviceRoleKey, leagueId, seasonNo });
  }
}

async function main() {
  const isCompositeLeagueCommand = command === 'sim-league';
  const endpoint = endpointByCommand[command];
  if (!endpoint && !isCompositeLeagueCommand) {
    printUsage();
    process.exit(1);
  }

  const baseUrl = readArg('baseUrl') ?? 'http://localhost:3000';
  const serviceRoleKey = readEnvVar('SUPABASE_SERVICE_ROLE_KEY');

  if (!serviceRoleKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY in environment or .env.local files.');
    process.exit(1);
  }

  const leagueIdRaw = readArg('leagueId');
  const seasonNoRaw = readArg('seasonNo');
  const batchSizeRaw = readArg('batchSize') ?? readArg('maxGames');

  const leagueId = leagueIdRaw ? parsePositiveInt(leagueIdRaw, '--leagueId') : undefined;
  const seasonNo = seasonNoRaw ? parsePositiveInt(seasonNoRaw, '--seasonNo') : undefined;
  const batchSize = batchSizeRaw ? parsePositiveInt(batchSizeRaw, '--batchSize') : 25;
  const loop = readBooleanFlag('loop', false);
  const queueFlag = readBooleanFlag('queue', false);
  const inlineFlag = readBooleanFlag('inline', false);
  const wait = readBooleanFlag('wait', false);
  const noSummary = readBooleanFlag('no-summary', false);
  const queueMode = inlineFlag ? false : (queueFlag || isCompositeLeagueCommand);

  if (isCompositeLeagueCommand) {
    if (!leagueId) {
      console.error('Missing --leagueId for sim-league command.');
      process.exit(1);
    }

    if (hasFlag('reset')) {
      await postApi({
        baseUrl,
        endpoint: '/api/sim/reset',
        serviceRoleKey,
        body: { leagueId },
      });
    }

    if (queueMode) {
      await runQueuedSimInBatches({
        baseUrl,
        serviceRoleKey,
        leagueId,
        seasonNo,
        batchSize,
        showFinalSummary: !noSummary,
      });
    } else {
      await runSimAllInBatches({
        baseUrl,
        serviceRoleKey,
        leagueId,
        seasonNo,
        batchSize,
        showFinalSummary: !noSummary,
      });
    }
    return;
  }

  let body = undefined;
  if (command === 'run') {
    const scheduleIdRaw = readArg('scheduleId') ?? readArg('scheduled');
    if (!scheduleIdRaw) {
      console.error('Missing --scheduleId (or legacy alias --scheduled) for run command.');
      process.exit(1);
    }
    const scheduleId = parsePositiveInt(scheduleIdRaw, '--scheduleId');
    body = { scheduleId };
  } else if (command === 'summary') {
    body = {
      ...(leagueId ? { leagueId } : {}),
      ...(seasonNo ? { seasonNo } : {}),
    };
  } else if (command === 'sim-all') {
    if (queueMode && loop) {
      await runQueuedSimInBatches({
        baseUrl,
        serviceRoleKey,
        leagueId,
        seasonNo,
        batchSize,
        showFinalSummary: !noSummary,
      });
      return;
    }

    if (!queueMode && loop) {
      await runSimAllInBatches({
        baseUrl,
        serviceRoleKey,
        leagueId,
        seasonNo,
        batchSize,
        showFinalSummary: !noSummary,
      });
      return;
    }

    body = buildSimAllBody({
      mode: queueMode ? 'queue' : 'inline',
      leagueId,
      seasonNo,
      maxGames: batchSize,
      includeSummary: !noSummary,
    });

    const payload = await postApi({ baseUrl, endpoint, serviceRoleKey, body });

    if (queueMode && wait) {
      const obj = asObjectPayload(payload, 'Unexpected queue enqueue payload.');
      const jobIds = Array.isArray(obj.queueJobIds) ? obj.queueJobIds.map((id) => String(id)) : [];
      if (jobIds.length > 0) {
        await waitForQueuedJobs({ baseUrl, serviceRoleKey, jobIds });
      }
      if (!noSummary) {
        await fetchSmokeSummary({ baseUrl, serviceRoleKey, leagueId, seasonNo });
      }
    }

    return;
  } else if (command === 'reset' && leagueId) {
    body = { leagueId };
  }

  await postApi({ baseUrl, endpoint, serviceRoleKey, body });
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message);
    if (error.cause) {
      console.error(`Cause: ${String(error.cause)}`);
    }
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
