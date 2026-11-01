import { create } from 'zustand';
import { settingsRepository } from '../../data/repositories/settings.repository';
import {
  decideTourOnLaunch,
  shouldMarkOwedAfterSetup,
  TOUR_COMPLETED_KEY,
  TOUR_OWED_VALUE,
  TOUR_STEPS,
} from './tourModel';

/**
 * R4c tour state. `requested` asks the overlay to start as soon as the main
 * tabs are on screen (after setup, on a launch that owes the tour, or from
 * Settings → Replay tour). Settings writes are plain app_settings rows —
 * never audited.
 */
interface TourState {
  active: boolean;
  index: number;
  requested: boolean;
  request: () => void;
  start: () => void;
  goTo: (index: number) => void;
  /** Skip / Done / nothing left to show: hide and record completion. */
  finish: (now?: Date) => Promise<void>;
}

export const useTourStore = create<TourState>((set, get) => ({
  active: false,
  index: 0,
  requested: false,
  request: () => {
    if (!get().active) set({ requested: true });
  },
  start: () => set({ active: true, index: 0, requested: false }),
  goTo: index => set({ index }),
  finish: async (now = new Date()) => {
    set({ active: false, index: 0, requested: false });
    await settingsRepository.setValue(TOUR_COMPLETED_KEY, now.toISOString()).catch(() => undefined);
  },
}));

/** The target the tour is pointing at right now, or null. */
export function selectTourTargetKey(state: Pick<TourState, 'active' | 'index'>) {
  return state.active ? TOUR_STEPS[state.index]?.targetKey ?? null : null;
}

/** App start (after hydrate): upgrade installs are marked done silently; an owed tour is requested. */
export async function initTourOnLaunch(hasOnboarded: boolean, now: Date = new Date()): Promise<void> {
  const value = await settingsRepository.getValue(TOUR_COMPLETED_KEY);
  const decision = decideTourOnLaunch({ hasOnboarded, value });
  if (decision === 'mark_done_silently') {
    await settingsRepository.setValue(TOUR_COMPLETED_KEY, now.toISOString());
  } else if (decision === 'show') {
    useTourStore.getState().request();
  }
}

/** Setup just completed (new install): owe the tour and ask for it. */
export async function requestTourAfterSetup(): Promise<void> {
  const value = await settingsRepository.getValue(TOUR_COMPLETED_KEY);
  if (shouldMarkOwedAfterSetup(value)) {
    await settingsRepository.setValue(TOUR_COMPLETED_KEY, TOUR_OWED_VALUE);
    useTourStore.getState().request();
  }
}

/** Settings → Replay tour. */
export function replayTour(): void {
  useTourStore.getState().request();
}
