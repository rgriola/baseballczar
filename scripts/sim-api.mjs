#!/usr/bin/env node
// Last touched by agent: 2026-05-05T16:46:34Z
// Purpose: Call local sim API endpoints from root npm scripts for testing.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const command = process.argv[2] ?? '';
const args = process.argv.slice(3);

const endpointByCommand = {
  'run-due': '/api/sim/run-due',
  'sim-all': '/api/sim/sim-all',
  run: '/api/sim/run',
};

function readArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return args[idx + 1];
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

async function main() {
  const endpoint = endpointByCommand[command];
  if (!endpoint) {
    console.error('Usage: node scripts/sim-api.mjs <run-due|sim-all|run> [--scheduleId <id>|--scheduled <id>] [--baseUrl <url>]');
    process.exit(1);
  }

  const baseUrl = readArg('baseUrl') ?? 'http://localhost:3000';
  const serviceRoleKey = readEnvVar('SUPABASE_SERVICE_ROLE_KEY');

  if (!serviceRoleKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY in environment or .env.local files.');
    process.exit(1);
  }

  let body;
  if (command === 'run') {
    const scheduleIdRaw = readArg('scheduleId') ?? readArg('scheduled');
    if (!scheduleIdRaw) {
      console.error('Missing --scheduleId (or legacy alias --scheduled) for run command.');
      process.exit(1);
    }
    const scheduleId = Number.parseInt(scheduleIdRaw, 10);
    if (!Number.isFinite(scheduleId) || scheduleId <= 0) {
      console.error('Invalid --scheduleId. Expected a positive integer.');
      process.exit(1);
    }
    body = JSON.stringify({ scheduleId });
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body,
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  console.log(`POST ${endpoint} -> ${response.status}`);
  if (typeof payload === 'string') {
    console.log(payload);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
