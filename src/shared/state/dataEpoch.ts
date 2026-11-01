import { create } from 'zustand';

/**
 * R4e: bumped after a backup restore replaced every row in SQLite.
 * Components that read app_settings once on mount (e.g. the feedback
 * button's saved position) list the epoch as an effect dependency so they
 * re-read without an app restart.
 */
interface DataEpochState {
  epoch: number;
}

export const useDataEpochStore = create<DataEpochState>(() => ({ epoch: 0 }));

export function bumpDataEpoch(): void {
  useDataEpochStore.setState(state => ({ epoch: state.epoch + 1 }));
}

export function useDataEpoch(): number {
  return useDataEpochStore(state => state.epoch);
}
