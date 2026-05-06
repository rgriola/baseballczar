// Last touched by agent: 2026-05-06T14:01:30Z
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSentryConfig } from '@sentry/nextjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBPACK_STATS_DIR = process.env.NEXT_WEBPACK_STATS_DIR
  ? path.resolve(APP_DIR, process.env.NEXT_WEBPACK_STATS_DIR)
  : null;

function createWebpackStatsPlugin(label) {
  return {
    apply(compiler) {
      compiler.hooks.done.tap('WriteWebpackStatsPlugin', (stats) => {
        if (!WEBPACK_STATS_DIR) return;

        try {
          const payload = stats.toJson({
            all: false,
            hash: true,
            builtAt: true,
            time: true,
            errors: true,
            warnings: true,
            cachedModules: true,
            dependentModules: true,
            nestedModules: true,
            orphanModules: true,
            runtimeModules: true,
            groupModulesByAttributes: false,
            groupModulesByCacheStatus: false,
            groupModulesByLayer: false,
            groupModulesByPath: false,
            groupModulesByType: false,
            chunks: true,
            chunkModules: true,
            chunkRelations: true,
            modules: true,
            reasons: true,
            profile: true,
            ids: true,
          });

          fs.mkdirSync(WEBPACK_STATS_DIR, { recursive: true });
          const outputPath = path.join(WEBPACK_STATS_DIR, `${label}.stats.json`);
          fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[webpack-stats] failed to write ${label} stats: ${message}`);
        }
      });
    },
  };
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer, nextRuntime }) => {
    // Suppress BullMQ dynamic require warning (child-processor.js uses expression-based require)
    if (isServer) {
      config.ignoreWarnings = [
        ...(config.ignoreWarnings ?? []),
        { module: /bullmq/ },
      ];
    }

    if (WEBPACK_STATS_DIR) {
      const label = !isServer ? 'client' : nextRuntime === 'edge' ? 'edge-server' : 'server';
      config.profile = true;
      config.plugins = config.plugins ?? [];
      config.plugins.push(createWebpackStatsPlugin(label));
    }

    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});
