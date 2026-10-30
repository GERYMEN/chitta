import { showSnackbar, SNACKBAR_DURATION_MS, useSnackbarStore } from '../snackbarStore';

beforeEach(() => {
  jest.useFakeTimers();
  useSnackbarStore.setState({ current: null });
});
afterEach(() => jest.useRealTimers());

describe('snackbarStore (Undo)', () => {
  it('auto-hides after 5 s', () => {
    showSnackbar({ message: 'Moved 1 item', actionLabel: 'Undo', onAction: jest.fn() });
    expect(SNACKBAR_DURATION_MS).toBe(5000);
    jest.advanceTimersByTime(4999);
    expect(useSnackbarStore.getState().current).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(useSnackbarStore.getState().current).toBeNull();
  });

  it('runs the action exactly once and hides', () => {
    const onAction = jest.fn();
    showSnackbar({ message: 'Moved 1 item', actionLabel: 'Undo', onAction });
    useSnackbarStore.getState().press();
    useSnackbarStore.getState().press();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(useSnackbarStore.getState().current).toBeNull();
  });

  it('a new snackbar replaces the old one; the old timer cannot hide it', () => {
    showSnackbar({ message: 'first' });
    jest.advanceTimersByTime(3000);
    showSnackbar({ message: 'second' });
    jest.advanceTimersByTime(3000);
    expect(useSnackbarStore.getState().current?.message).toBe('second');
    jest.advanceTimersByTime(2000);
    expect(useSnackbarStore.getState().current).toBeNull();
  });
});
