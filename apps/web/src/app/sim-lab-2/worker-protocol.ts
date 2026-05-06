// Last touched by agent: 2026-05-05T18:04:00Z
// Purpose: Defines message protocol and profile keys for Sim Lab 2 browser worker.

import type { SimRun } from './sim-run-types';

export type ManagerProfileKey = 'balanced' | 'aggressive' | 'conservative' | 'analytics';

export type SimWorkerRequest = {
  type: 'run-sim';
  requestId: number;
  seed: number;
  homeProfileKey: ManagerProfileKey;
  awayProfileKey: ManagerProfileKey;
};

export type SimWorkerSuccess = {
  type: 'success';
  requestId: number;
  payload: SimRun;
};

export type SimWorkerError = {
  type: 'error';
  requestId: number;
  error: string;
};

export type SimWorkerResponse = SimWorkerSuccess | SimWorkerError;
