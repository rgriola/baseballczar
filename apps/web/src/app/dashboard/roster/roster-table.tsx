'use client';

import { useState, useMemo } from 'react';
import RosterToggle from './roster-toggle';
import { CountryFlag } from './country-flag';

const HAND_LABEL: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };

function totalSkill(p: Player) {
  return +(p.speed + p.stamina + p.ag + p.eye + p.avg + p.strength + p.play_intel + p.bunting + p.fielding + p.throw).toFixed(1);
}

interface Player {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  position: string;
  roster_status: string;
  fielder: boolean;
  batt_order: number;
  rotation_slot: number;
  age: number;
  height: number;
  weight: number;
  hand_throw: number;
  hand_batting: number;
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
  salary: number;
  contract: number;
  country_id: number;
}

type SortKey =
  | 'jersey_no' | 'name' | 'position' | 'status' | 'age' | 'height' | 'weight'
  | 'speed' | 'stamina' | 'ag' | 'eye' | 'avg' | 'strength' | 'play_intel'
  | 'bunting' | 'fielding' | 'throw' | 'total' | 'salary' | 'contract' | 'slot';

type SortDir = 'asc' | 'desc';

function getSortValue(p: Player, key: SortKey): number | string {
  switch (key) {
    case 'jersey_no': return p.jersey_no;
    case 'name': return `${p.last_name} ${p.first_name}`.toLowerCase();
    case 'position': return p.position;
    case 'status': return p.roster_status;
    case 'age': return p.age;
    case 'height': return p.height;
    case 'weight': return p.weight;
    case 'speed': return p.speed;
    case 'stamina': return p.stamina;
    case 'ag': return p.ag;
    case 'eye': return p.eye;
    case 'avg': return p.avg;
    case 'strength': return p.strength;
    case 'play_intel': return p.play_intel;
    case 'bunting': return p.bunting;
    case 'fielding': return p.fielding;
    case 'throw': return p.throw;
    case 'total': return totalSkill(p);
    case 'salary': return p.salary;
    case 'contract': return p.contract;
    case 'slot': return p.rotation_slot;
    default: return 0;
  }
}

function SortHeader({ label, sortKey, currentKey, currentDir, onSort, align }: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey | null;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = currentKey === sortKey;
  const arrow = active ? (currentDir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      className={`pb-2 cursor-pointer select-none hover:text-white ${align === 'right' ? 'text-right' : ''} ${active ? 'text-white' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      {label}{arrow}
    </th>
  );
}

function useSortedPlayers(players: Player[], defaultKey: SortKey | null = null) {
  const [sortKey, setSortKey] = useState<SortKey | null>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    if (!sortKey) return players;
    return [...players].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const diff = (aVal as number) - (bVal as number);
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [players, sortKey, sortDir]);

  function onSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'position' || key === 'status' ? 'asc' : 'desc');
    }
  }

  return { sorted, sortKey, sortDir, onSort };
}

export function HitterTable({ hitters, activeCount }: { hitters: Player[]; activeCount: number }) {
  const { sorted, sortKey, sortDir, onSort } = useSortedPlayers(hitters);
  const atLimit = activeCount === 15;
  const over = activeCount > 15;
  const under = activeCount < 15;

  return (
    <div className="overflow-x-auto">
      {under && (
        <div className="mb-3 rounded border border-yellow-700/50 bg-yellow-900/20 px-3 py-2 text-sm text-yellow-400">
          {activeCount}/15 active — you need {15 - activeCount} more active position player{15 - activeCount > 1 ? 's' : ''}
        </div>
      )}
      {over && (
        <div className="mb-3 rounded border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-400">
          {activeCount}/15 active — move {activeCount - 15} position player{activeCount - 15 > 1 ? 's' : ''} to reserve
        </div>
      )}
      {atLimit && (
        <div className="mb-3 rounded border border-green-700/50 bg-green-900/20 px-3 py-2 text-sm text-green-400">
          15/15 active position players ✓
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-400">
            <SortHeader label="#" sortKey="jersey_no" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Name" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Pos" sortKey="position" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
            <th className="pb-2"></th>
            <SortHeader label="Age" sortKey="age" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="Ht" sortKey="height" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="Wt" sortKey="weight" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <th className="pb-2 text-right">B/T</th>
            <SortHeader label="SPD" sortKey="speed" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="STA" sortKey="stamina" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="AG" sortKey="ag" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="EYE" sortKey="eye" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="AVG" sortKey="avg" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="STR" sortKey="strength" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="PI" sortKey="play_intel" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="BNT" sortKey="bunting" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="FLD" sortKey="fielding" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="THR" sortKey="throw" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="TOT" sortKey="total" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="Salary" sortKey="salary" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="Ctr" sortKey="contract" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id} className={`border-b border-gray-800/50 ${p.roster_status === 'active' ? 'text-gray-300' : 'text-gray-500'}`}>
              <td className="py-1.5">{p.jersey_no}</td>
              <td className="py-1.5 font-medium whitespace-nowrap"><CountryFlag countryId={p.country_id} /> {p.first_name} {p.last_name}</td>
              <td className="py-1.5">{p.position}</td>
              <td className="py-1.5">
                <span className={`rounded px-1.5 py-0.5 text-xs ${p.roster_status === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                  {p.roster_status}
                </span>
              </td>
              <td className="py-1.5">
                {(p.roster_status === 'active' || p.roster_status === 'reserve') && (
                  <RosterToggle playerId={p.id} currentStatus={p.roster_status} />
                )}
              </td>
              <td className="py-1.5 text-right">{p.age}</td>
              <td className="py-1.5 text-right">{p.height}″</td>
              <td className="py-1.5 text-right">{p.weight}</td>
              <td className="py-1.5 text-right">{HAND_LABEL[p.hand_batting]}/{HAND_LABEL[p.hand_throw]}</td>
              <td className="py-1.5 text-right">{p.speed}</td>
              <td className="py-1.5 text-right">{p.stamina}</td>
              <td className="py-1.5 text-right">{p.ag}</td>
              <td className="py-1.5 text-right">{p.eye}</td>
              <td className="py-1.5 text-right">{p.avg}</td>
              <td className="py-1.5 text-right">{p.strength}</td>
              <td className="py-1.5 text-right">{p.play_intel}</td>
              <td className="py-1.5 text-right">{p.bunting}</td>
              <td className="py-1.5 text-right">{p.fielding}</td>
              <td className="py-1.5 text-right">{p.throw}</td>
              <td className="py-1.5 text-right font-semibold text-white">{totalSkill(p)}</td>
              <td className="py-1.5 text-right">${p.salary.toLocaleString()}</td>
              <td className="py-1.5 text-right">{p.contract}y</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function slotLabel(slot: number): string {
  if (slot >= 1 && slot <= 5) return `SP${slot}`;
  if (slot >= 6 && slot <= 9) return `RP${slot - 5}`;
  if (slot === 10) return 'CL';
  return '—';
}

export function PitcherTable({ pitchers, activeCount }: { pitchers: Player[]; activeCount: number }) {
  const { sorted, sortKey, sortDir, onSort } = useSortedPlayers(pitchers);
  const atLimit = activeCount === 10;
  const over = activeCount > 10;
  const under = activeCount < 10;

  return (
    <div className="overflow-x-auto">
      {under && (
        <div className="mb-3 rounded border border-yellow-700/50 bg-yellow-900/20 px-3 py-2 text-sm text-yellow-400">
          {activeCount}/10 active — you need {10 - activeCount} more active pitcher{10 - activeCount > 1 ? 's' : ''}
        </div>
      )}
      {over && (
        <div className="mb-3 rounded border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-400">
          {activeCount}/10 active — move {activeCount - 10} pitcher{activeCount - 10 > 1 ? 's' : ''} to reserve
        </div>
      )}
      {atLimit && (
        <div className="mb-3 rounded border border-green-700/50 bg-green-900/20 px-3 py-2 text-sm text-green-400">
          10/10 active pitchers ✓
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-400">
            <SortHeader label="#" sortKey="jersey_no" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Name" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Slot" sortKey="slot" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
            <SortHeader label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
            <th className="pb-2"></th>
            <SortHeader label="Age" sortKey="age" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="Ht" sortKey="height" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="Wt" sortKey="weight" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <th className="pb-2 text-right">T</th>
            <SortHeader label="SPD" sortKey="speed" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="STA" sortKey="stamina" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="AG" sortKey="ag" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="EYE" sortKey="eye" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="AVG" sortKey="avg" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="STR" sortKey="strength" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="PI" sortKey="play_intel" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="BNT" sortKey="bunting" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="FLD" sortKey="fielding" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="THR" sortKey="throw" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="TOT" sortKey="total" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="Salary" sortKey="salary" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
            <SortHeader label="Ctr" sortKey="contract" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id} className={`border-b border-gray-800/50 ${p.roster_status === 'active' ? 'text-gray-300' : 'text-gray-500'}`}>
              <td className="py-1.5">{p.jersey_no}</td>
              <td className="py-1.5 font-medium whitespace-nowrap"><CountryFlag countryId={p.country_id} /> {p.first_name} {p.last_name}</td>
              <td className="py-1.5">{slotLabel(p.rotation_slot)}</td>
              <td className="py-1.5">
                <span className={`rounded px-1.5 py-0.5 text-xs ${p.roster_status === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                  {p.roster_status}
                </span>
              </td>
              <td className="py-1.5">
                {(p.roster_status === 'active' || p.roster_status === 'reserve') && (
                  <RosterToggle playerId={p.id} currentStatus={p.roster_status} />
                )}
              </td>
              <td className="py-1.5 text-right">{p.age}</td>
              <td className="py-1.5 text-right">{p.height}″</td>
              <td className="py-1.5 text-right">{p.weight}</td>
              <td className="py-1.5 text-right">{HAND_LABEL[p.hand_throw]}</td>
              <td className="py-1.5 text-right">{p.speed}</td>
              <td className="py-1.5 text-right">{p.stamina}</td>
              <td className="py-1.5 text-right">{p.ag}</td>
              <td className="py-1.5 text-right">{p.eye}</td>
              <td className="py-1.5 text-right">{p.avg}</td>
              <td className="py-1.5 text-right">{p.strength}</td>
              <td className="py-1.5 text-right">{p.play_intel}</td>
              <td className="py-1.5 text-right">{p.bunting}</td>
              <td className="py-1.5 text-right">{p.fielding}</td>
              <td className="py-1.5 text-right">{p.throw}</td>
              <td className="py-1.5 text-right font-semibold text-white">{totalSkill(p)}</td>
              <td className="py-1.5 text-right">${p.salary.toLocaleString()}</td>
              <td className="py-1.5 text-right">{p.contract}y</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
