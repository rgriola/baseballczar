// Last touched by agent: 2026-05-07T16:49:29Z
'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import { updateLineup, setGameLineup } from '../actions';
import { CountryFlag } from '../roster/country-flag';

const HAND_LABEL: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };
const DEFENSE_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const;

type DefensePosition = (typeof DEFENSE_POSITIONS)[number];
type DragPlayerState = { source: 'lineup' | 'bench'; playerId: number };
const LEFT_THROW_LOCKED_POSITIONS: readonly DefensePosition[] = ['C', '2B', '3B', 'SS'];

const DEFENSE_LAYOUT: Array<{ pos: DefensePosition; x: number; y: number }> = [
  { pos: 'LF', x: 18.75, y: 25 },
  { pos: 'CF', x: 50, y: 16.67 },
  { pos: 'RF', x: 78.75, y: 25 },
  { pos: 'SS', x: 37.5, y: 38.33 },
  { pos: '2B', x: 63.75, y: 38.33 },
  { pos: '3B', x: 29.38, y: 58.33 },
  { pos: '1B', x: 70.63, y: 58.33 },
  { pos: 'C', x: 50, y: 92.83 },
  { pos: 'DH', x: 14.5, y: 87.5 },
];

interface Hitter {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  position: string;
  batt_order: number;
  age: number;
  height: number;
  weight: number;
  hand_batting: number;
  hand_throw: number;
  speed: number;
  stamina: number;
  ag: number;
  eye: number;
  avg: number;
  strength: number;
  play_intel: number;
  bunting: number;
  fielding: number;
  throw: number;
  country_id: number;
}

function toDefensePosition(position: string): DefensePosition | null {
  return (DEFENSE_POSITIONS as readonly string[]).includes(position)
    ? (position as DefensePosition)
    : null;
}

function getSkillTotal(player: Hitter): number {
  return (
    player.speed
    + player.stamina
    + player.ag
    + player.eye
    + player.avg
    + player.strength
    + player.play_intel
    + player.bunting
    + player.fielding
    + player.throw
  );
}

function isLeftHandThrower(player: Hitter): boolean {
  return player.hand_throw === 2;
}

function isDefenseSlotLockedForPlayer(player: Hitter, position: DefensePosition): boolean {
  return isLeftHandThrower(player) && LEFT_THROW_LOCKED_POSITIONS.includes(position);
}

function buildUniquePositionMap(
  lineup: Hitter[],
  priorAssignments?: Record<number, DefensePosition>,
): Record<number, DefensePosition> {
  const next: Record<number, DefensePosition> = {};
  const used = new Set<DefensePosition>();
  const unassigned: Hitter[] = [];

  for (const player of lineup) {
    const preferred = priorAssignments?.[player.id] ?? toDefensePosition(player.position) ?? null;
    if (preferred && !used.has(preferred) && !isDefenseSlotLockedForPlayer(player, preferred)) {
      next[player.id] = preferred;
      used.add(preferred);
    } else {
      unassigned.push(player);
    }
  }

  for (const player of unassigned) {
    const open = DEFENSE_POSITIONS.find(
      (position) => !used.has(position) && !isDefenseSlotLockedForPlayer(player, position),
    );
    if (!open) continue;
    next[player.id] = open;
    used.add(open);
  }

  return next;
}

export default function LineupEditor({
  hitters,
  scheduleId,
  gameLabel,
}: {
  hitters: Hitter[];
  scheduleId?: number;
  gameLabel?: string;
}) {
  const starters = hitters
    .filter((player) => player.batt_order >= 1 && player.batt_order <= 9)
    .sort((a, b) => a.batt_order - b.batt_order);
  const reserves = hitters.filter((player) => player.batt_order === 0 || player.batt_order > 9);

  while (starters.length < 9 && reserves.length > 0) {
    starters.push(reserves.shift()!);
  }

  const [orderedPlayers, setOrderedPlayers] = useState<Hitter[]>(() => [...starters, ...reserves]);
  const lineup = orderedPlayers.slice(0, 9);
  const bench = orderedPlayers.slice(9);
  const [positionsByPlayer, setPositionsByPlayer] = useState<Record<number, DefensePosition>>(
    () => buildUniquePositionMap(starters),
  );
  const [dragPlayer, setDragPlayer] = useState<DragPlayerState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPositionsByPlayer((previous) => buildUniquePositionMap(lineup, previous));
  }, [orderedPlayers]);

  const lineupById = useMemo(() => new Map(lineup.map((player) => [player.id, player])), [lineup]);

  const playerByPosition = useMemo(() => {
    const map: Partial<Record<DefensePosition, Hitter>> = {};
    for (const player of lineup) {
      const assignedPosition = positionsByPlayer[player.id];
      if (assignedPosition) {
        map[assignedPosition] = player;
      }
    }
    return map;
  }, [lineup, positionsByPlayer]);

  function dropPlayerOnDefense(position: DefensePosition) {
    if (!dragPlayer || dragPlayer.source !== 'lineup') return;
    const dragLineupPlayerId = dragPlayer.playerId;
    const draggedPlayer = lineupById.get(dragLineupPlayerId);
    if (!draggedPlayer) {
      setDragPlayer(null);
      return;
    }

    if (isDefenseSlotLockedForPlayer(draggedPlayer, position)) {
      setMessage('Left-handed throwers cannot play C, 2B, 3B, or SS.');
      setDragPlayer(null);
      return;
    }

    setPositionsByPlayer((previous) => {
      const next = { ...previous };
      const sourcePosition = previous[dragLineupPlayerId];

      let displacedPlayerId: number | null = null;
      for (const player of lineup) {
        if (player.id !== dragLineupPlayerId && previous[player.id] === position) {
          displacedPlayerId = player.id;
          break;
        }
      }

      next[dragLineupPlayerId] = position;

      if (displacedPlayerId !== null && sourcePosition) {
        next[displacedPlayerId] = sourcePosition;
      }

      return buildUniquePositionMap(lineup, next);
    });

    setDragPlayer(null);
    setMessage(null);
  }

  function swapPlayersAtIndices(sourceIndex: number, targetIndex: number) {
    const sourcePlayer = orderedPlayers[sourceIndex];
    const targetPlayer = orderedPlayers[targetIndex];
    if (!sourcePlayer || !targetPlayer) return;

    const nextOrdered = [...orderedPlayers];
    [nextOrdered[sourceIndex], nextOrdered[targetIndex]] = [
      nextOrdered[targetIndex],
      nextOrdered[sourceIndex],
    ];

    const nextLineup = nextOrdered.slice(0, 9);
    const sourceWasLineup = sourceIndex < 9;
    const targetWasLineup = targetIndex < 9;

    setOrderedPlayers(nextOrdered);

    setPositionsByPlayer((previous) => {
      const next = { ...previous };

      if (sourceWasLineup && !targetWasLineup) {
        const inheritedPosition = previous[sourcePlayer.id] ?? 'DH';
        delete next[sourcePlayer.id];
        next[targetPlayer.id] = inheritedPosition;
      } else if (!sourceWasLineup && targetWasLineup) {
        const inheritedPosition = previous[targetPlayer.id] ?? 'DH';
        delete next[targetPlayer.id];
        next[sourcePlayer.id] = inheritedPosition;
      }

      return buildUniquePositionMap(nextLineup, next);
    });

    setMessage(null);
  }

  function dropOnLineup(lineupIndex: number) {
    if (!dragPlayer) return;

    const sourceIndex = orderedPlayers.findIndex((player) => player.id === dragPlayer.playerId);
    if (sourceIndex === -1) {
      setDragPlayer(null);
      return;
    }

    if (sourceIndex === lineupIndex) {
      setDragPlayer(null);
      return;
    }

    swapPlayersAtIndices(sourceIndex, lineupIndex);
    setDragPlayer(null);
  }

  function dropOnBench(benchIndex: number) {
    if (!dragPlayer) return;

    const sourceIndex = orderedPlayers.findIndex((player) => player.id === dragPlayer.playerId);
    if (sourceIndex === -1) {
      setDragPlayer(null);
      return;
    }

    const targetIndex = 9 + benchIndex;
    if (targetIndex >= orderedPlayers.length) {
      setDragPlayer(null);
      return;
    }

    if (sourceIndex === targetIndex) {
      setDragPlayer(null);
      return;
    }

    swapPlayersAtIndices(sourceIndex, targetIndex);
    setDragPlayer(null);
  }

  function save() {
    if (lineup.length !== 9) {
      setMessage('Lineup must have exactly 9 players.');
      return;
    }

    const orderedPositions = lineup.map((player) => positionsByPlayer[player.id]);
    if (orderedPositions.some((position) => !position)) {
      setMessage('All lineup players must have a defensive position.');
      return;
    }

    const hasLockedLeftThrowAssignment = lineup.some((player) => {
      const assignedPosition = positionsByPlayer[player.id];
      return assignedPosition ? isDefenseSlotLockedForPlayer(player, assignedPosition) : false;
    });
    if (hasLockedLeftThrowAssignment) {
      setMessage('Left-handed throwers cannot play C, 2B, 3B, or SS.');
      return;
    }

    const uniquePositions = new Set(orderedPositions);
    if (uniquePositions.size !== DEFENSE_POSITIONS.length) {
      setMessage('Defense requires unique C/1B/2B/3B/SS/LF/CF/RF/DH assignments.');
      return;
    }

    // Verify exact coverage: 8 field positions + 1 DH
    const fieldPositions: DefensePosition[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
    const missingField = fieldPositions.find((pos) => !uniquePositions.has(pos));
    if (missingField) {
      setMessage(`Lineup is missing defensive position: ${missingField}`);
      return;
    }
    if (!uniquePositions.has('DH')) {
      setMessage('Lineup must include exactly 1 DH (Designated Hitter).');
      return;
    }

    const formData = new FormData();
    formData.set('playerIds', JSON.stringify(lineup.map((player) => player.id)));
    formData.set('positions', JSON.stringify(orderedPositions));
    formData.set('benchIds', JSON.stringify(bench.map((player) => player.id)));

    if (scheduleId) {
      formData.set('scheduleId', String(scheduleId));
    }

    startTransition(async () => {
      const result = scheduleId
        ? await setGameLineup(formData)
        : await updateLineup(formData);
      setMessage(result?.error ?? (scheduleId ? `Game lineup saved!` : 'Lineup + defense saved!'));
    });
  }

  return (
    <div>
      {gameLabel && (
        <div className="mb-4 rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-2.5 text-sm text-amber-200">
          ⚾ <strong>{gameLabel}</strong> — Changes apply to this game only. Your default lineup is unchanged.
        </div>
      )}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 order-2">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Defense</h2>
          <span className="text-xs text-gray-400">Drag lineup players or defenders onto positions</span>
        </div>

        <div className="relative mx-auto aspect-[4/3] w-full max-w-[620px] overflow-hidden rounded-xl border border-gray-700 bg-[#0d331d]">
          <svg viewBox="0 0 800 600" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <defs>
              <linearGradient id="simLab2FieldBg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1b6f33" />
                <stop offset="72%" stopColor="#0b4b20" />
                <stop offset="100%" stopColor="#204f26" />
              </linearGradient>
            </defs>

            <rect x="0" y="0" width="800" height="600" fill="url(#simLab2FieldBg)" />
            <path d="M400 545 L730 215 Q400 -45 70 215 Z" fill="#1f7334" />

            <line x1="-30" y1="130" x2="400" y2="545" stroke="#ece8df" strokeWidth="3" />
            <line x1="830" y1="130" x2="400" y2="545" stroke="#ece8df" strokeWidth="3" />

            <circle cx="400" cy="310" r="172" fill="#7c5933" />
            <path d="M400 545 L540 395 L400 245 L260 395 Z" fill="#1f7334" />
            <circle cx="540" cy="395" r="40" fill="#7c5933" />
            <circle cx="260" cy="395" r="40" fill="#7c5933" />
            <circle cx="400" cy="545" r="40" fill="#7c5933" />
            <circle cx="400" cy="405" r="22" fill="#7c5933" />

            <polyline
              points="400,545 540,395 400,245 260,395 400,545"
              fill="none"
              stroke="#efe9dc"
              strokeOpacity="0.82"
              strokeWidth="4"
            />

            <rect x="531" y="386" width="18" height="18" transform="rotate(45 540 395)" fill="#ffffff" />
            <rect x="391" y="236" width="18" height="18" transform="rotate(45 400 245)" fill="#ffffff" />
            <rect x="251" y="386" width="18" height="18" transform="rotate(45 260 395)" fill="#ffffff" />
            <polygon points="391,528 409,528 409,536 400,545 391,536" fill="#ffffff" />

            <rect x="360" y="530" width="24" height="18" fill="none" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.8" />
            <rect x="416" y="530" width="24" height="18" fill="none" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.8" />
            <rect x="390" y="548" width="20" height="20" fill="none" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.8" />

            <rect x="126" y="530" width="170" height="44" rx="3" transform="rotate(45 211 552)" fill="#121525" stroke="#2f3348" strokeWidth="3" />
            <rect x="504" y="530" width="170" height="44" rx="3" transform="rotate(-45 589 552)" fill="#121525" stroke="#2f3348" strokeWidth="3" />
            <rect x="0" y="578" width="800" height="22" fill="#2a6227" fillOpacity="0.5" />
          </svg>

          {DEFENSE_LAYOUT.map((slot) => {
            const player = playerByPosition[slot.pos] ?? null;
            return (
              <div
                key={slot.pos}
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropPlayerOnDefense(slot.pos)}
              >
                <div
                  draggable={Boolean(player)}
                  onDragStart={() => {
                    if (!player) return;
                    setDragPlayer({ source: 'lineup', playerId: player.id });
                  }}
                  onDragEnd={() => setDragPlayer(null)}
                  className={`w-24 rounded border border-gray-600/80 bg-gray-950/85 px-1.5 py-0.5 text-center backdrop-blur-sm ${player ? 'cursor-grab' : ''
                    }`}
                >
                  <p className="text-[9px] font-semibold text-blue-300">{slot.pos}</p>
                  {player ? (
                    <p className="truncate text-[11px] text-white">#{player.jersey_no} {player.last_name}</p>
                  ) : (
                    <p className="text-[9px] text-gray-400">Drop lineup player</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Defense accepts only players currently in the lineup. Bench players must be swapped into lineup first.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Left-handed throwers are locked out of C, 2B, 3B, and SS.
        </p>
      </section>

      <section className="space-y-6 order-1">
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
          <h2 className="mb-1 text-lg font-semibold text-white">Game Day - Lineup</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-400">
                  <th className="pb-2 w-12">Ord</th>
                  <th className="pb-2 w-12">#</th>
                  <th className="pb-2">Pos</th>
                  <th className="pb-2">Player</th>
                  <th className="pb-2 text-right">B</th>
                  <th className="pb-2 text-right">T</th>
                  <th className="pb-2 text-right">SD</th>
                  <th className="pb-2 text-right">SM</th>
                  <th className="pb-2 text-right">AG</th>
                  <th className="pb-2 text-right">EY</th>
                  <th className="pb-2 text-right">AV</th>
                  <th className="pb-2 text-right">ST</th>
                  <th className="pb-2 text-right">PI</th>
                  {/*<th className="pb-2 text-right">BNT</th>*/}
                  <th className="pb-2 text-right">GL</th>
                  <th className="pb-2 text-right">TH</th>
                  <th className="pb-2 text-right">Def</th>
                  <th className="pb-2 text-right">TOT</th>
                </tr>
              </thead>
              <tbody>
                {orderedPlayers.map((player, index) => {
                  const isLineupRow = index < 9;
                  const benchIndex = index - 9;

                  return (
                    <Fragment key={player.id}>
                      {index === 9 && (
                        <tr className="border-y border-gray-700/80 bg-gray-900/70">
                          <td colSpan={17} className="py-2 text-center text-xs uppercase tracking-wider text-gray-400">
                            Bench ({bench.length})
                          </td>
                        </tr>
                      )}

                      <tr
                        draggable
                        onDragStart={() => setDragPlayer({ source: isLineupRow ? 'lineup' : 'bench', playerId: player.id })}
                        onDragEnd={() => setDragPlayer(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (isLineupRow) {
                            dropOnLineup(index);
                            return;
                          }
                          dropOnBench(benchIndex);
                        }}
                        className={`border-b border-gray-800/50 cursor-grab ${isLineupRow ? 'text-gray-300' : 'text-gray-400'}`}
                      >
                        <td className={`py-2 font-medium ${isLineupRow ? 'text-white' : 'text-gray-400'}`}>
                          {isLineupRow ? index + 1 : `B${benchIndex + 1}`}
                        </td>
                        <td className="py-2 whitespace-nowrap">#{player.jersey_no}</td>
                        <td className="py-2 whitespace-nowrap">{player.position}</td>
                        <td className="py-2 whitespace-nowrap">{player.last_name}
                        </td>
                        <td className="py-2 text-right">{HAND_LABEL[player.hand_batting]}</td>
                        <td className="py-2 text-right">{HAND_LABEL[player.hand_throw]}</td>
                        <td className="py-2 text-right">{player.speed}</td>
                        <td className="py-2 text-right">{player.stamina}</td>
                        <td className="py-2 text-right">{player.ag}</td>
                        <td className="py-2 text-right">{player.eye}</td>
                        <td className="py-2 text-right">{player.avg}</td>
                        <td className="py-2 text-right">{player.strength}</td>
                        <td className="py-2 text-right">{player.play_intel}</td>
                        <td className="py-2 text-right">{player.fielding}</td>
                        <td className="py-2 text-right">{player.throw}</td>
                        <td className={`py-2 text-right ${isLineupRow ? 'text-blue-300' : 'text-gray-500'}`}>
                          {isLineupRow ? (positionsByPlayer[player.id] ?? '—') : '—'}
                        </td>
                        <td className="py-2 text-right font-semibold text-white">{getSkillTotal(player)}</td>
                      </tr>
                    </Fragment>
                  );
                })}

                {bench.length === 0 && (
                  <>
                    <tr className="border-y border-gray-700/80 bg-gray-900/70">
                      <td colSpan={17} className="py-2 text-center text-xs uppercase tracking-wider text-gray-400">
                        Bench (0)
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={17} className="py-4 text-center text-gray-500">No bench players</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={isPending || lineup.length !== 9}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isPending ? 'Saving...' : 'Save Lineup'}
          </button>
          {message && (
            <p className={`text-sm ${message.includes('saved') ? 'text-green-400' : 'text-red-400'}`}>
              {message}
            </p>
          )}
        </div>
      </section>
    </div>
    </div>
  );
}
