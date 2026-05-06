// Last touched by agent: 2026-05-06T14:01:30Z
// Purpose: Summarize webpack stats by module compile time and graph fan-out.

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATS_DIR = '.next/perf-stats';
const DEFAULT_TOP = 15;

function readArg(name) {
  const prefix = `--${name}=`;
  const pair = process.argv.find((arg) => arg.startsWith(prefix));
  return pair ? pair.slice(prefix.length) : undefined;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flattenModules(modules, acc = []) {
  if (!Array.isArray(modules)) return acc;
  for (const mod of modules) {
    if (!mod || typeof mod !== 'object') continue;

    const isSyntheticGroup =
      typeof mod.type === 'string' &&
      mod.type.endsWith(' modules') &&
      !mod.identifier &&
      !mod.name &&
      !mod.nameForCondition;

    if (!isSyntheticGroup) {
      acc.push(mod);
    }

    if (Array.isArray(mod.modules) && mod.modules.length > 0) {
      flattenModules(mod.modules, acc);
    }
  }
  return acc;
}

function collectAllModules(stats) {
  const acc = [];
  flattenModules(stats.modules, acc);

  if (Array.isArray(stats.chunks)) {
    for (const chunk of stats.chunks) {
      if (!chunk || typeof chunk !== 'object') continue;
      flattenModules(chunk.modules, acc);
    }
  }

  return acc;
}

function resolveModuleId(mod) {
  return (
    mod.identifier ||
    mod.nameForCondition ||
    mod.name ||
    `${mod.moduleType ?? 'module'}:${mod.id ?? 'unknown'}`
  );
}

function resolveModuleName(mod) {
  const name = mod.nameForCondition || mod.name || resolveModuleId(mod);
  const cwd = process.cwd();
  if (typeof name === 'string' && name.startsWith(cwd)) {
    return path.relative(cwd, name);
  }
  return String(name);
}

function resolveBuildMs(mod) {
  const profile = mod.profile;
  if (!profile || typeof profile !== 'object') return 0;
  if (typeof profile.total === 'number' && Number.isFinite(profile.total)) {
    return profile.total;
  }

  let total = 0;
  for (const value of Object.values(profile)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
    }
  }
  return total;
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

function fileLabel(filePath) {
  return path.basename(filePath).replace(/\.stats\.json$/, '');
}

function summarizeStats(filePath, topN) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const stats = JSON.parse(raw);

  const modules = collectAllModules(stats);
  const byId = new Map();
  const outEdges = new Map();

  for (const mod of modules) {
    const id = resolveModuleId(mod);
    if (!byId.has(id)) byId.set(id, mod);
  }

  for (const mod of modules) {
    const targetId = resolveModuleId(mod);
    const reasons = Array.isArray(mod.reasons) ? mod.reasons : [];

    for (const reason of reasons) {
      if (!reason || typeof reason !== 'object') continue;
      const sourceId = reason.moduleIdentifier || reason.moduleName;
      if (!sourceId) continue;

      const set = outEdges.get(sourceId) ?? new Set();
      set.add(targetId);
      outEdges.set(sourceId, set);
    }
  }

  const rows = [];
  for (const [id, mod] of byId.entries()) {
    const buildMs = resolveBuildMs(mod);
    const fanOut = outEdges.get(id)?.size ?? 0;
    rows.push({
      id,
      name: resolveModuleName(mod),
      buildMs,
      fanOut,
      size: typeof mod.size === 'number' ? mod.size : 0,
    });
  }

  const topByBuild = rows
    .filter((row) => row.buildMs > 0)
    .sort((a, b) => b.buildMs - a.buildMs)
    .slice(0, topN);

  const topByFanOut = rows
    .filter((row) => row.fanOut > 0)
    .sort((a, b) => {
      if (b.fanOut !== a.fanOut) return b.fanOut - a.fanOut;
      return b.buildMs - a.buildMs;
    })
    .slice(0, topN);

  return {
    label: fileLabel(filePath),
    compileTimeMs: typeof stats.time === 'number' ? stats.time : null,
    totalModules: rows.length,
    topByBuild,
    topByFanOut,
  };
}

function renderConsoleSummary(summary) {
  console.log(`\nCompiler: ${summary.label}`);
  console.log(
    `Total modules: ${summary.totalModules}${summary.compileTimeMs === null ? '' : ` | compile ${formatMs(summary.compileTimeMs)}`}`,
  );

  console.log('Top modules by compile time:');
  if (summary.topByBuild.length === 0) {
    console.log('  (none with profile timings)');
  } else {
    summary.topByBuild.forEach((row, index) => {
      console.log(
        `  ${index + 1}. ${formatMs(row.buildMs)} | fan-out ${row.fanOut} | ${row.name}`,
      );
    });
  }

  console.log('Top modules by fan-out:');
  if (summary.topByFanOut.length === 0) {
    console.log('  (none with fan-out edges)');
  } else {
    summary.topByFanOut.forEach((row, index) => {
      console.log(
        `  ${index + 1}. fan-out ${row.fanOut} | ${formatMs(row.buildMs)} | ${row.name}`,
      );
    });
  }
}

function renderMarkdown(summaries) {
  const lines = [];
  lines.push('# Webpack Stats Summary');
  lines.push('');

  for (const summary of summaries) {
    lines.push(`## ${summary.label}`);
    lines.push('');
    lines.push(
      `- Compile time: ${summary.compileTimeMs === null ? 'n/a' : formatMs(summary.compileTimeMs)}`,
    );
    lines.push(`- Total modules: ${summary.totalModules}`);
    lines.push('');

    lines.push('### Top Compile-Time Modules');
    lines.push('');
    if (summary.topByBuild.length === 0) {
      lines.push('- (none with profile timings)');
    } else {
      summary.topByBuild.forEach((row, index) => {
        lines.push(
          `${index + 1}. ${formatMs(row.buildMs)} | fan-out ${row.fanOut} | ${row.name}`,
        );
      });
    }
    lines.push('');

    lines.push('### Top Fan-Out Modules');
    lines.push('');
    if (summary.topByFanOut.length === 0) {
      lines.push('- (none with fan-out edges)');
    } else {
      summary.topByFanOut.forEach((row, index) => {
        lines.push(
          `${index + 1}. fan-out ${row.fanOut} | ${formatMs(row.buildMs)} | ${row.name}`,
        );
      });
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const statsDir = readArg('dir') ?? DEFAULT_STATS_DIR;
  const topN = toNumber(readArg('top'), DEFAULT_TOP);
  const outPath = readArg('out');

  const fullStatsDir = path.resolve(process.cwd(), statsDir);
  if (!fs.existsSync(fullStatsDir)) {
    console.error(`Stats directory not found: ${fullStatsDir}`);
    process.exit(1);
  }

  const statsFiles = fs
    .readdirSync(fullStatsDir)
    .filter((name) => name.endsWith('.stats.json'))
    .map((name) => path.join(fullStatsDir, name))
    .sort();

  if (statsFiles.length === 0) {
    console.error(`No *.stats.json files found in ${fullStatsDir}`);
    process.exit(1);
  }

  const summaries = statsFiles.map((filePath) => summarizeStats(filePath, topN));
  summaries.forEach(renderConsoleSummary);

  if (outPath) {
    const fullOutPath = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(fullOutPath), { recursive: true });
    fs.writeFileSync(fullOutPath, renderMarkdown(summaries), 'utf8');
    console.log(`\nWrote markdown summary to ${fullOutPath}`);
  }
}

main();
