'use client';

import dynamic from 'next/dynamic';
import type { FieldCanvasV2Props } from './FieldCanvasV2';

const FieldCanvasV2 = dynamic(() => import('./FieldCanvasV2'), {
  ssr: false,
  loading: () => (
    <div
      style={{ width: 800, height: 600 }}
      className="bg-black rounded-lg border border-zinc-800 flex items-center justify-center text-zinc-500"
    >
      Loading field…
    </div>
  ),
});

export default function FieldCanvasV2Client(props: FieldCanvasV2Props) {
  return <FieldCanvasV2 {...props} />;
}
