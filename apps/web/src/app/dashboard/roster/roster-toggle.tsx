'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleRosterStatus } from '../actions';

export default function RosterToggle({
  playerId,
  currentStatus,
}: {
  playerId: number;
  currentStatus: 'active' | 'reserve';
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const newStatus = currentStatus === 'active' ? 'reserve' : 'active';

  function handleToggle() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('playerId', String(playerId));
      fd.set('newStatus', newStatus);
      const result = await toggleRosterStatus(fd);
      if (!result.error) {
        router.refresh();
      }
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`rounded px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
        currentStatus === 'active'
          ? 'bg-yellow-900/50 text-yellow-400 hover:bg-yellow-800/60'
          : 'bg-green-900/50 text-green-400 hover:bg-green-800/60'
      }`}
    >
      {isPending ? '…' : currentStatus === 'active' ? '→ Reserve' : '→ Active'}
    </button>
  );
}
