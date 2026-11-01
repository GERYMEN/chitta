import { initTourOnLaunch, replayTour, requestTourAfterSetup, selectTourTargetKey, useTourStore } from '../tourStore';
import { settingsRepository } from '../../../data/repositories/settings.repository';
import { TOUR_COMPLETED_KEY } from '../tourModel';

jest.mock('../../../data/repositories/settings.repository', () => {
  const values = new Map<string, string>();
  return {
    __values: values,
    settingsRepository: {
      getValue: jest.fn(async (key: string) => (values.has(key) ? values.get(key)! : null)),
      setValue: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      setMany: jest.fn(),
    },
  };
});

const values: Map<string, string> = jest.requireMock('../../../data/repositories/settings.repository').__values;
const NOW = new Date('2026-11-01T09:00:00.000Z');

beforeEach(() => {
  values.clear();
  jest.clearAllMocks();
  useTourStore.setState({ active: false, index: 0, requested: false });
});

describe('tour trigger (R4c)', () => {
  it('existing install (upgrade): key set to now silently, not requested', async () => {
    await initTourOnLaunch(true, NOW);
    expect(values.get(TOUR_COMPLETED_KEY)).toBe(NOW.toISOString());
    expect(useTourStore.getState().requested).toBe(false);
  });

  it('new install: nothing at launch during setup; owed + requested after setup', async () => {
    await initTourOnLaunch(false, NOW);
    expect(values.has(TOUR_COMPLETED_KEY)).toBe(false);
    await requestTourAfterSetup();
    expect(values.get(TOUR_COMPLETED_KEY)).toBe('');
    expect(useTourStore.getState().requested).toBe(true);
  });

  it('owed tour (app closed before it ran) is requested on the next launch', async () => {
    values.set(TOUR_COMPLETED_KEY, '');
    await initTourOnLaunch(true, NOW);
    expect(useTourStore.getState().requested).toBe(true);
    expect(values.get(TOUR_COMPLETED_KEY)).toBe('');
  });

  it('done: neither launch nor setup requests it; Replay does', async () => {
    values.set(TOUR_COMPLETED_KEY, '2026-10-01T00:00:00.000Z');
    await initTourOnLaunch(true, NOW);
    await requestTourAfterSetup();
    expect(useTourStore.getState().requested).toBe(false);
    replayTour();
    expect(useTourStore.getState().requested).toBe(true);
  });

  it('start → step targets → Skip/Done records completion (plain setting, no audit)', async () => {
    useTourStore.getState().request();
    useTourStore.getState().start();
    expect(useTourStore.getState()).toMatchObject({ active: true, index: 0, requested: false });
    expect(selectTourTargetKey(useTourStore.getState())).toBe('home.sync');
    useTourStore.getState().goTo(5);
    expect(selectTourTargetKey(useTourStore.getState())).toBe('feedback.button');
    await useTourStore.getState().finish(NOW);
    expect(useTourStore.getState().active).toBe(false);
    expect(selectTourTargetKey(useTourStore.getState())).toBeNull();
    expect(values.get(TOUR_COMPLETED_KEY)).toBe(NOW.toISOString());
    expect(settingsRepository.setMany).not.toHaveBeenCalled();
  });
});
