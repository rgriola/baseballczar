'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type FieldCanvasType from './FieldCanvas';

/**
 * SSR-safe wrapper for FieldCanvas.
 * PixiJS references `navigator` at import time, so it cannot be loaded on the server.
 */
const FieldCanvas = dynamic(() => import('./FieldCanvas'), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-lg border border-gray-700 flex items-center justify-center text-gray-500 text-sm"
      style={{ width: 800, height: 600, maxWidth: '100%' }}
    >
      Loading 2D sim…
    </div>
  ),
});

export default function FieldCanvasClient(props: ComponentProps<typeof FieldCanvasType>) {
  return <FieldCanvas {...props} />;
}
