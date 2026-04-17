'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function ProvisionButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleProvision() {
    startTransition(async () => {
      setError(null);
      const res = await fetch('/api/provision', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Provisioning failed');
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-4">
      <button
        onClick={handleProvision}
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? 'Creating your team...' : 'Create My Team'}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
