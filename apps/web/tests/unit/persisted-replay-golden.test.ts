// Last touched by agent: 2026-05-07T22:45:00Z
// Purpose: Golden replay fixture test to lock event order and timing for persisted playback.

import { describe, expect, it } from 'vitest';
import { buildPersistedSnapshots } from '@/app/dashboard/games/[id]/persisted-replay-data';
import { GOLDEN_GROUNDOUT_PAYLOAD } from '../fixtures/persisted-replay/golden-groundout.fixture';

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

describe('persisted replay golden fixture', () => {
  it('keeps stable event ordering and key timing markers', () => {
    const replay = buildPersistedSnapshots(GOLDEN_GROUNDOUT_PAYLOAD);
    const timedEvents = replay.snapshots.flatMap((snapshot) => (
      snapshot.events.map((event) => ({ time: snapshot.time, event }))
    ));

    const eventTypes = timedEvents.map(({ event }) => event.type);

    const atBatStart = timedEvents.find(({ event }) => event.type === 'at-bat-start');
    const contact = timedEvents.find(({ event }) => event.type === 'contact');
    const throwReleased = timedEvents.find(({ event }) => event.type === 'throw-released');
    const runnerOut = timedEvents.find(({ event }) => event.type === 'runner-out');
    const playComplete = timedEvents.find(({ event }) => event.type === 'play-complete');

    if (!atBatStart || atBatStart.event.type !== 'at-bat-start') {
      throw new Error('Expected at-bat-start event');
    }
    if (!contact || contact.event.type !== 'contact') {
      throw new Error('Expected contact event');
    }
    if (!throwReleased || throwReleased.event.type !== 'throw-released') {
      throw new Error('Expected throw-released event');
    }
    if (!runnerOut || runnerOut.event.type !== 'runner-out') {
      throw new Error('Expected runner-out event');
    }
    if (!playComplete || playComplete.event.type !== 'play-complete') {
      throw new Error('Expected play-complete event');
    }

    const inningChangeSnapshot = replay.snapshots.find((snapshot) => (
      snapshot.events.some((event) => event.type === 'inning-change')
    ));
    if (!inningChangeSnapshot) {
      throw new Error('Expected inning-change snapshot');
    }

    const runner = inningChangeSnapshot.runners.find((candidate) => candidate.id === 42);
    if (!runner) {
      throw new Error('Expected runner 42 in inning-change snapshot');
    }

    const fingerprint = {
      snapshotCount: replay.snapshots.length,
      totalDurationSec: round(replay.totalDurationSec),
      eventTypes,
      batterCard: {
        hand: atBatStart.event.batter.hand,
        avg: atBatStart.event.batter.avg,
        power: atBatStart.event.batter.power,
        eye: atBatStart.event.batter.eye,
        speed: atBatStart.event.batter.speed,
      },
      pitcherCard: {
        hand: atBatStart.event.pitcher.hand,
        ctrl: atBatStart.event.pitcher.ctrl,
        stam: atBatStart.event.pitcher.stam,
        throwing: atBatStart.event.pitcher.throwing,
      },
      contact: {
        distanceFt: contact.event.distanceFt,
        peakHeightFt: round(contact.event.peakHeightFt ?? 0),
        hangTimeSec: round(contact.event.hangTimeSec ?? 0),
        sprayDirection: contact.event.sprayDirection,
      },
      runnerProfile: {
        speedFps: round(runner.speedFps),
        agility: runner.agility,
      },
      timeline: {
        contactAt: round(contact.time),
        throwReleasedAt: round(throwReleased.time),
        runnerOutAt: round(runnerOut.time),
        playCompleteAt: round(playComplete.time),
      },
    };

    expect(fingerprint).toEqual({
      snapshotCount: 33,
      totalDurationSec: 4.5338,
      eventTypes: [
        'inning-change',
        'at-bat-start',
        'pitch',
        'pitch-result',
        'pitch',
        'pitch-result',
        'pitch',
        'pitch-result',
        'pitch',
        'pitch-result',
        'contact',
        'ball-landed',
        'ball-fielded',
        'throw-released',
        'ball-received',
        'runner-out',
        'at-bat-end',
        'manager-signal',
        'play-complete',
      ],
      batterCard: {
        hand: 'L',
        avg: 8,
        power: 9,
        eye: 7,
        speed: 6,
      },
      pitcherCard: {
        hand: 'L',
        ctrl: 4,
        stam: 9,
        throwing: 8,
      },
      contact: {
        distanceFt: 88,
        peakHeightFt: 3,
        hangTimeSec: 1,
        sprayDirection: 'LCF',
      },
      runnerProfile: {
        speedFps: 27.9111,
        agility: 3,
      },
      timeline: {
        contactAt: 1.57,
        throwReleasedAt: 3.22,
        runnerOutAt: 3.9071,
        playCompleteAt: 4.5338,
      },
    });
  });
});
