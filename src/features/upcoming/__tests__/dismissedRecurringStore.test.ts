import { useDismissedRecurringStore } from '../state/dismissedRecurringStore';
import { approxAmountLabel, shortDateLabel } from '../upcomingLabels';

describe('dismissedRecurringStore (session only)', () => {
  beforeEach(() => useDismissedRecurringStore.getState().reset());

  it('dismisses a key once and resets', () => {
    const { dismiss } = useDismissedRecurringStore.getState();
    dismiss('qa streamer');
    dismiss('qa streamer');
    expect(useDismissedRecurringStore.getState().dismissed).toEqual(['qa streamer']);
    useDismissedRecurringStore.getState().reset();
    expect(useDismissedRecurringStore.getState().dismissed).toEqual([]);
  });
});

describe('upcoming labels', () => {
  it('marks amounts as estimates and formats dates', () => {
    expect(approxAmountLabel(19900).startsWith('~')).toBe(true);
    expect(shortDateLabel(new Date(2026, 9, 5, 12).toISOString())).toBe('5 Oct 2026');
  });
});
