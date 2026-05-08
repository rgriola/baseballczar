// Last touched by agent: 2026-05-07T01:37:55Z
// Purpose: Manages fixed SP/RP/CL slots with drag-and-drop pitcher assignment.
'use client';

import { useMemo, useState, useTransition } from 'react';
import { toggleRosterStatus, updateRotation } from '../actions';
import { CountryFlag } from '../roster/country-flag';

const HAND_LABEL: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };
const STARTER_SLOT_COUNT = 5;
const RELIEVER_SLOT_COUNT = 4;
const BULLPEN_TOTAL_COUNT = 5;

type RosterFilter = 'all' | 'reserve' | 'active';

interface Pitcher {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  roster_status: string;
  rotation_slot: number;
  age: number;
  height: number;
  weight: number;
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

interface InitialAssignments {
  starterSlots: Array<number | null>;
  relieverSlots: Array<number | null>;
  closerId: number | null;
}

function totalSkill(pitcher: Pitcher) {
  return +(
    pitcher.speed
    + pitcher.stamina
    + pitcher.ag
    + pitcher.eye
    + pitcher.avg
    + pitcher.strength
    + pitcher.play_intel
    + pitcher.bunting
    + pitcher.fielding
    + pitcher.throw
  ).toFixed(1);
}

function statusRank(status: string) {
  if (status === 'active') return 0;
  if (status === 'reserve') return 1;
  return 2;
}

function byPitcherSort(a: Pitcher, b: Pitcher) {
  const rankDiff = statusRank(a.roster_status) - statusRank(b.roster_status);
  if (rankDiff !== 0) return rankDiff;

  const lastDiff = a.last_name.localeCompare(b.last_name);
  if (lastDiff !== 0) return lastDiff;

  return a.first_name.localeCompare(b.first_name);
}

function statusClass(status: string) {
  if (status === 'active') return 'bg-green-900/40 text-green-300';
  if (status === 'reserve') return 'bg-gray-800 text-gray-300';
  return 'bg-yellow-900/40 text-yellow-300';
}

function healthStrokeClass(pitcher: Pitcher | null) {
  if (!pitcher) return 'border-l-gray-700';
  return pitcher.roster_status === 'active' ? 'border-l-green-500' : 'border-l-red-500';
}

function normalizeStarterSlot(value: number) {
  if (!Number.isFinite(value)) return 1;
  if (value < 1) return 1;
  if (value > STARTER_SLOT_COUNT) return STARTER_SLOT_COUNT;
  return Math.floor(value);
}

function buildInitialAssignments(sortedPitchers: Pitcher[]): InitialAssignments {
  const starterSlots: Array<number | null> = Array.from({ length: STARTER_SLOT_COUNT }, () => null);

  for (const pitcher of sortedPitchers) {
    if (pitcher.rotation_slot >= 1 && pitcher.rotation_slot <= STARTER_SLOT_COUNT) {
      const starterIndex = pitcher.rotation_slot - 1;
      if (starterSlots[starterIndex] === null) {
        starterSlots[starterIndex] = pitcher.id;
      }
    }
  }

  const bullpenCandidates = sortedPitchers
    .filter((pitcher) => pitcher.rotation_slot >= 6 && pitcher.rotation_slot <= 12)
    .sort((a, b) => a.rotation_slot - b.rotation_slot);

  const savedCloser = bullpenCandidates.find((pitcher) => pitcher.rotation_slot === 10) ?? null;
  const nonCloserCandidates = bullpenCandidates.filter((pitcher) => pitcher.rotation_slot !== 10);

  const relieverSlots: Array<number | null> = Array.from({ length: RELIEVER_SLOT_COUNT }, () => null);
  for (let i = 0; i < RELIEVER_SLOT_COUNT; i += 1) {
    relieverSlots[i] = nonCloserCandidates[i]?.id ?? null;
  }

  const overflowCloserCandidate = nonCloserCandidates[RELIEVER_SLOT_COUNT] ?? null;
  const closerId = savedCloser?.id ?? overflowCloserCandidate?.id ?? null;

  return {
    starterSlots,
    relieverSlots,
    closerId,
  };
}

export default function PitchingStaffEditor({
  pitchers,
  nextStarterSlot,
}: {
  pitchers: Pitcher[];
  nextStarterSlot: number;
}) {
  const initialPitchers = useMemo(() => [...pitchers].sort(byPitcherSort), [pitchers]);
  const initialAssignments = useMemo(() => buildInitialAssignments(initialPitchers), [initialPitchers]);

  const [allPitchers, setAllPitchers] = useState<Pitcher[]>(initialPitchers);
  const [starterSlots, setStarterSlots] = useState<Array<number | null>>(initialAssignments.starterSlots);
  const [relieverSlots, setRelieverSlots] = useState<Array<number | null>>(initialAssignments.relieverSlots);
  const [closerId, setCloserId] = useState<number | null>(initialAssignments.closerId);
  const [dragPitcherId, setDragPitcherId] = useState<number | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [isDeactivating, startDeactivateTransition] = useTransition();
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');
  const [message, setMessage] = useState<string | null>(null);

  const pitcherById = useMemo(() => {
    return new Map(allPitchers.map((pitcher) => [pitcher.id, pitcher]));
  }, [allPitchers]);

  const filteredPitchers = useMemo(() => {
    if (rosterFilter === 'all') return allPitchers;
    return allPitchers.filter((pitcher) => pitcher.roster_status === rosterFilter);
  }, [allPitchers, rosterFilter]);

  const starterCount = starterSlots.filter((id) => id !== null).length;
  const relieverCount = relieverSlots.filter((id) => id !== null).length;
  const bullpenCount = relieverCount + (closerId !== null ? 1 : 0);

  const startersReady = starterCount === STARTER_SLOT_COUNT;
  const bullpenReady = bullpenCount === BULLPEN_TOTAL_COUNT;

  const nextSlot = normalizeStarterSlot(nextStarterSlot);
  const lastSlot = nextSlot === 1 ? STARTER_SLOT_COUNT : nextSlot - 1;

  function pitcherForId(id: number | null): Pitcher | null {
    if (id === null) return null;
    return pitcherById.get(id) ?? null;
  }

  function clearPitcherFromAllSlots(
    pitcherId: number,
    starters: Array<number | null>,
    relievers: Array<number | null>,
    closer: number | null,
  ) {
    const nextStarters = starters.map((id) => (id === pitcherId ? null : id));
    const nextRelievers = relievers.map((id) => (id === pitcherId ? null : id));
    const nextCloser = closer === pitcherId ? null : closer;
    return { nextStarters, nextRelievers, nextCloser };
  }

  function assignPitcherToStarterSlot(slotIndex: number, pitcherId: number) {
    if (slotIndex < 0 || slotIndex >= STARTER_SLOT_COUNT) return;
    if (!pitcherById.has(pitcherId)) return;

    const sourceStarterIndex = starterSlots.findIndex((id) => id === pitcherId);
    const sourceRelieverIndex = relieverSlots.findIndex((id) => id === pitcherId);
    const sourceWasCloser = closerId === pitcherId;
    const targetStarterId = starterSlots[slotIndex];

    const { nextStarters, nextRelievers, nextCloser } = clearPitcherFromAllSlots(
      pitcherId,
      starterSlots,
      relieverSlots,
      closerId,
    );

    let swappedCloser = nextCloser;
    nextStarters[slotIndex] = pitcherId;

    if (targetStarterId !== null && targetStarterId !== pitcherId) {
      if (sourceStarterIndex >= 0 && sourceStarterIndex !== slotIndex) {
        nextStarters[sourceStarterIndex] = targetStarterId;
      } else if (sourceRelieverIndex >= 0) {
        nextRelievers[sourceRelieverIndex] = targetStarterId;
      } else if (sourceWasCloser) {
        swappedCloser = targetStarterId;
      }
    }

    setStarterSlots(nextStarters);
    setRelieverSlots(nextRelievers);
    setCloserId(swappedCloser);
    setMessage(null);
  }

  function assignPitcherToRelieverSlot(slotIndex: number, pitcherId: number) {
    if (slotIndex < 0 || slotIndex >= RELIEVER_SLOT_COUNT) return;
    if (!pitcherById.has(pitcherId)) return;

    const sourceStarterIndex = starterSlots.findIndex((id) => id === pitcherId);
    const sourceRelieverIndex = relieverSlots.findIndex((id) => id === pitcherId);
    const sourceWasCloser = closerId === pitcherId;
    const targetRelieverId = relieverSlots[slotIndex];

    const { nextStarters, nextRelievers, nextCloser } = clearPitcherFromAllSlots(
      pitcherId,
      starterSlots,
      relieverSlots,
      closerId,
    );

    let swappedCloser = nextCloser;
    nextRelievers[slotIndex] = pitcherId;

    if (targetRelieverId !== null && targetRelieverId !== pitcherId) {
      if (sourceRelieverIndex >= 0 && sourceRelieverIndex !== slotIndex) {
        nextRelievers[sourceRelieverIndex] = targetRelieverId;
      } else if (sourceStarterIndex >= 0) {
        nextStarters[sourceStarterIndex] = targetRelieverId;
      } else if (sourceWasCloser) {
        swappedCloser = targetRelieverId;
      }
    }

    setStarterSlots(nextStarters);
    setRelieverSlots(nextRelievers);
    setCloserId(swappedCloser);
    setMessage(null);
  }

  function assignPitcherToCloserSlot(pitcherId: number) {
    if (!pitcherById.has(pitcherId)) return;

    const sourceStarterIndex = starterSlots.findIndex((id) => id === pitcherId);
    const sourceRelieverIndex = relieverSlots.findIndex((id) => id === pitcherId);
    if (closerId === pitcherId) {
      return;
    }

    const targetCloserId = closerId;

    const { nextStarters, nextRelievers } = clearPitcherFromAllSlots(
      pitcherId,
      starterSlots,
      relieverSlots,
      closerId,
    );

    if (targetCloserId !== null && targetCloserId !== pitcherId) {
      if (sourceStarterIndex >= 0) {
        nextStarters[sourceStarterIndex] = targetCloserId;
      } else if (sourceRelieverIndex >= 0) {
        nextRelievers[sourceRelieverIndex] = targetCloserId;
      }
    }

    setStarterSlots(nextStarters);
    setRelieverSlots(nextRelievers);
    setCloserId(pitcherId);
    setMessage(null);
  }

  function designateCloserFromRelieverSlot(slotIndex: number) {
    const candidateId = relieverSlots[slotIndex];
    if (candidateId === null) return;

    const previousCloser = closerId;
    const nextRelievers = [...relieverSlots];
    nextRelievers[slotIndex] = previousCloser;

    setRelieverSlots(nextRelievers);
    setCloserId(candidateId);
    setMessage(null);
  }

  function assignmentLabel(pitcherId: number): string | null {
    const starterIndex = starterSlots.findIndex((id) => id === pitcherId);
    if (starterIndex >= 0) return `SP${starterIndex + 1}`;

    const relieverIndex = relieverSlots.findIndex((id) => id === pitcherId);
    if (relieverIndex >= 0) return `RP${relieverIndex + 1}`;

    if (closerId === pitcherId) return 'CL';
    return null;
  }

  function dropToStarterSlot(slotIndex: number) {
    if (dragPitcherId === null) return;
    assignPitcherToStarterSlot(slotIndex, dragPitcherId);
    setDragPitcherId(null);
  }

  function dropToRelieverSlot(slotIndex: number) {
    if (dragPitcherId === null) return;
    assignPitcherToRelieverSlot(slotIndex, dragPitcherId);
    setDragPitcherId(null);
  }

  function dropToCloserSlot() {
    if (dragPitcherId === null) return;
    assignPitcherToCloserSlot(dragPitcherId);
    setDragPitcherId(null);
  }

  function movePitcherToStarterSimple(pitcherId: number) {
    if (starterSlots.includes(pitcherId)) return;
    const emptyStarter = starterSlots.findIndex((id) => id === null);
    const targetStarter = emptyStarter >= 0 ? emptyStarter : STARTER_SLOT_COUNT - 1;
    assignPitcherToStarterSlot(targetStarter, pitcherId);
  }

  function movePitcherToBullpenSimple(pitcherId: number) {
    if (relieverSlots.includes(pitcherId)) return;
    const emptyReliever = relieverSlots.findIndex((id) => id === null);
    const targetReliever = emptyReliever >= 0 ? emptyReliever : RELIEVER_SLOT_COUNT - 1;
    assignPitcherToRelieverSlot(targetReliever, pitcherId);
  }

  function sitPitcher(pitcherId: number) {
    const pitcher = pitcherById.get(pitcherId);
    if (!pitcher) return;

    const inStarters = starterSlots.includes(pitcherId);
    const inBullpen = relieverSlots.includes(pitcherId) || closerId === pitcherId;

    if (inStarters && starterCount <= STARTER_SLOT_COUNT) {
      setMessage('Cannot sit: rotation cannot drop below 5 starters.');
      return;
    }

    if (inBullpen && bullpenCount <= BULLPEN_TOTAL_COUNT) {
      setMessage('Cannot sit: bullpen cannot drop below 5 pitchers (including CL).');
      return;
    }

    startDeactivateTransition(async () => {
      if (pitcher.roster_status === 'active') {
        const formData = new FormData();
        formData.set('playerId', String(pitcher.id));
        formData.set('newStatus', 'reserve');
        const result = await toggleRosterStatus(formData);
        if (result.error) {
          setMessage(result.error);
          return;
        }
      }

      setStarterSlots((prev) => prev.map((id) => (id === pitcher.id ? null : id)));
      setRelieverSlots((prev) => prev.map((id) => (id === pitcher.id ? null : id)));
      setCloserId((prev) => (prev === pitcher.id ? null : prev));
      setAllPitchers((prev) => {
        return [...prev.map((p) => (p.id === pitcher.id ? { ...p, roster_status: 'reserve' } : p))].sort(byPitcherSort);
      });

      setMessage(`Sat #${pitcher.jersey_no} ${pitcher.last_name}.`);
    });
  }

  function savePitchingStaff() {
    const starterIds = starterSlots.filter((id): id is number => id !== null);
    const relieverIds = relieverSlots.filter((id): id is number => id !== null);

    if (starterIds.length !== STARTER_SLOT_COUNT) {
      setMessage('Rotation must have exactly 5 starters.');
      return;
    }

    if (relieverIds.length !== RELIEVER_SLOT_COUNT || closerId === null) {
      setMessage('Bullpen must have RP1-RP4 and one CL.');
      return;
    }

    const allAssigned = [...starterIds, ...relieverIds, closerId];
    if (new Set(allAssigned).size !== allAssigned.length) {
      setMessage('Each slot must have a unique pitcher.');
      return;
    }

    const formData = new FormData();
    formData.set('pitcherIds', JSON.stringify(starterIds));
    formData.set('bullpenIds', JSON.stringify(relieverIds));
    formData.set('closerId', JSON.stringify(closerId));

    startSaveTransition(async () => {
      const result = await updateRotation(formData);
      setMessage(result.error ?? 'Pitching staff saved!');
    });
  }

  const starterMissing = STARTER_SLOT_COUNT - starterCount;
  const bullpenMissing = BULLPEN_TOTAL_COUNT - bullpenCount;
  const slotRows = [
    ...Array.from({ length: STARTER_SLOT_COUNT }, (_, index) => ({
      kind: 'starter' as const,
      label: `SP${index + 1}`,
      index,
    })),
    ...Array.from({ length: RELIEVER_SLOT_COUNT }, (_, index) => ({
      kind: 'reliever' as const,
      label: `RP${index + 1}`,
      index,
    })),
    {
      kind: 'closer' as const,
      label: 'CL',
      index: -1,
    },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Rotation & Bullpen (Fixed Slots)</h2>
          <span className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">
            SP {starterCount}/{STARTER_SLOT_COUNT} | BP {bullpenCount}/{BULLPEN_TOTAL_COUNT}
          </span>
        </div>

        {(starterMissing > 0 || bullpenMissing > 0) && (
          <p className="mb-3 rounded border border-red-800/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">
            Rotation and bullpen must be 5 and 5. Missing: SP {Math.max(0, starterMissing)}, BP {Math.max(0, bullpenMissing)}.
          </p>
        )}

        <div className="space-y-2">
          {slotRows.map((row) => {
            const pitcherId = row.kind === 'starter'
              ? starterSlots[row.index]
              : row.kind === 'reliever'
                ? relieverSlots[row.index]
                : closerId;
            const pitcher = pitcherForId(pitcherId);
            const isNextStarter = row.kind === 'starter' && row.index + 1 === nextSlot;
            const isLastStarter = row.kind === 'starter' && row.index + 1 === lastSlot;

            return (
              <div
                key={row.label}
                className={`grid grid-cols-[72px_minmax(0,1fr)] overflow-hidden rounded border ${
                  isNextStarter
                    ? 'border-blue-500/70'
                    : isLastStarter
                      ? 'border-purple-500/70'
                      : 'border-gray-800'
                }`}
              >
                <div className="flex items-center justify-center border-r border-gray-800 bg-gray-900 px-2 py-2 text-xs font-semibold text-gray-300">
                  {row.label}
                </div>

                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (row.kind === 'starter') {
                      dropToStarterSlot(row.index);
                      return;
                    }
                    if (row.kind === 'reliever') {
                      dropToRelieverSlot(row.index);
                      return;
                    }
                    dropToCloserSlot();
                  }}
                  className={`border-l-4 bg-gray-950/60 px-3 py-2 ${healthStrokeClass(pitcher)}`}
                >
                  {pitcher ? (
                    <div
                      draggable
                      onDragStart={() => setDragPitcherId(pitcher.id)}
                      onDragEnd={() => setDragPitcherId(null)}
                      className="flex min-w-0 cursor-grab items-center justify-between gap-3"
                    >
                      <div className="flex min-w-0 items-center gap-2 text-sm text-white">
                        <span>#{pitcher.jersey_no}</span>
                        <span className="truncate">{pitcher.last_name}</span>
                        <span className="text-gray-300">
                          ({HAND_LABEL[pitcher.hand_throw]}{isNextStarter ? '*' : ''})
                        </span>
                        {isLastStarter && (
                          <span className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] text-purple-200">last</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {row.kind === 'reliever' && (
                          <button
                            onClick={() => designateCloserFromRelieverSlot(row.index)}
                            className="rounded-[4px] bg-blue-900/40 px-2 py-1 text-xs text-blue-300 hover:bg-blue-800/50"
                          >
                            CL
                          </button>
                        )}
                        <button
                          onClick={() => sitPitcher(pitcher.id)}
                          disabled={isDeactivating}
                          className="rounded-[4px] bg-red-900/40 px-2 py-1 text-xs text-red-300 hover:bg-red-800/50 disabled:opacity-50"
                        >
                          sit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">Drop pitcher row here</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={savePitchingStaff}
            disabled={isSaving || isDeactivating || !startersReady || !bullpenReady || closerId === null}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Rotation & Bullpen'}
          </button>

          {message && (
            <p className={`text-sm ${message.includes('saved') || message.includes('Sat') ? 'text-green-400' : 'text-red-400'}`}>
              {message}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Pitcher Roster</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">All pitchers, active + reserve</span>
            <div className="inline-flex overflow-hidden rounded border border-gray-700">
              {(['all', 'reserve', 'active'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setRosterFilter(filter)}
                  className={`px-2 py-1 text-xs font-semibold ${
                    rosterFilter === filter
                      ? 'bg-blue-700 text-white'
                      : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2">Pitcher</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">H</th>
                <th className="pb-2 text-right">SD</th>
                <th className="pb-2 text-right">SM</th>
                <th className="pb-2 text-right">AG</th>
                <th className="pb-2 text-right">EY</th>
                <th className="pb-2 text-right">AV</th>
                <th className="pb-2 text-right">ST</th>
                <th className="pb-2 text-right">PI</th>
               {/* <th className="pb-2 text-right">BNT</th>*/}
                <th className="pb-2 text-right">GL</th>
                <th className="pb-2 text-right">TH</th>
                <th className="pb-2 text-right">TOT</th>
                <th className="pb-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPitchers.map((pitcher) => {
                const assignedLabel = assignmentLabel(pitcher.id);
                const isAssigned = assignedLabel !== null;

                return (
                  <tr
                    key={pitcher.id}
                    draggable={!isAssigned}
                    onDragStart={() => setDragPitcherId(pitcher.id)}
                    onDragEnd={() => setDragPitcherId(null)}
                    className={`border-b border-gray-800/50 ${isAssigned ? 'text-gray-300' : 'cursor-grab text-gray-300'}`}
                  >
                    <td className="py-2 whitespace-nowrap font-medium text-white"> #{pitcher.jersey_no} {pitcher.last_name}
                    </td>
                    <td>{assignedLabel && (
                          <span className="rounded bg-blue-900/40 px-2 py-1 text-xs text-blue-300">{assignedLabel}</span>
                        )}</td>
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${statusClass(pitcher.roster_status)}`}>
                        {pitcher.roster_status}
                      </span>
                    </td>
                    <td className="py-2 text-right">{HAND_LABEL[pitcher.hand_throw]}</td>
                    <td className="py-2 text-right">{pitcher.speed}</td>
                    <td className="py-2 text-right">{pitcher.stamina}</td>
                    <td className="py-2 text-right">{pitcher.ag}</td>
                    <td className="py-2 text-right">{pitcher.eye}</td>
                    <td className="py-2 text-right">{pitcher.avg}</td>
                    <td className="py-2 text-right">{pitcher.strength}</td>
                    <td className="py-2 text-right">{pitcher.play_intel}</td>
                   {/* <td className="py-2 text-right">{pitcher.bunting}</td>*/}
                    <td className="py-2 text-right">{pitcher.fielding}</td>
                    <td className="py-2 text-right">{pitcher.throw}</td>
                    <td className="py-2 text-right font-semibold text-white">{totalSkill(pitcher)}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => movePitcherToStarterSimple(pitcher.id)}
                          className="rounded bg-blue-900/40 px-2 py-1 text-xs text-blue-300 hover:bg-blue-800/50"
                        >
                          SP
                        </button>
                        <button
                          onClick={() => movePitcherToBullpenSimple(pitcher.id)}
                          className="rounded bg-yellow-900/40 px-2 py-1 text-xs text-yellow-300 hover:bg-yellow-800/50"
                        >
                          BP
                        </button>
                        <button
                          onClick={() => assignPitcherToCloserSlot(pitcher.id)}
                          className="rounded bg-red-900/40 px-2 py-1 text-xs text-red-300 hover:bg-red-800/50"
                        >
                          CL
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredPitchers.length === 0 && (
                <tr>
                  <td colSpan={15} className="py-4 text-center text-sm text-gray-500">
                    No pitchers for the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
