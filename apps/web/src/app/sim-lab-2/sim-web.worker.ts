// Last touched by agent: 2026-05-05T02:18:58Z
// Purpose: Browser worker for off-main-thread Sim Lab 2 full-game simulation.

import { runSim } from './sim-runner';
import type { SimWorkerRequest, SimWorkerResponse } from './worker-protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimWorkerRequest>) => void) | null;
  postMessage: (message: SimWorkerResponse) => void;
};

scope.onmessage = (event: MessageEvent<SimWorkerRequest>): void => {
  const request = event.data;
  if (!request || request.type !== 'run-sim') return;

  try {
    const payload = runSim(request.seed, request.homeProfileKey, request.awayProfileKey);
    const response: SimWorkerResponse = {
      type: 'success',
      requestId: request.requestId,
      payload,
    };
    scope.postMessage(response);
  } catch (error) {
    const response: SimWorkerResponse = {
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : 'Unknown worker simulation error',
    };
    scope.postMessage(response);
  }
};

export {};
