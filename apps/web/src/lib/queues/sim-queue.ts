import { Queue } from 'bullmq';
import { connection } from './connection';

export interface SimJobData {
  scheduleId: number;
  leagueId: number;
}

export const simQueue = new Queue<SimJobData>('sim-game', { connection });
