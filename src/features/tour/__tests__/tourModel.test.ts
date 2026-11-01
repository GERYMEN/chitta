import {
  decideTourOnLaunch,
  isLastStep,
  nextAfter,
  shouldMarkOwedAfterSetup,
  stepCounter,
  stepOutcome,
  TOUR_STEPS,
  tourKeyState,
} from '../tourModel';

describe('tour steps (R4c)', () => {
  it('six steps in order, each with a target and copy', () => {
    expect(TOUR_STEPS.map(s => s.targetKey)).toEqual([
      'home.sync',
      'tab.Pending',
      'home.periods',
      'transactions.search',
      'accounts.balance',
      'feedback.button',
    ]);
    expect(TOUR_STEPS.map(s => s.tab)).toEqual(['Home', 'Pending', 'Home', 'Transactions', 'Accounts', null]);
    expect(TOUR_STEPS[5].body).toBe('Found a bug or have an idea? Tap here twice.');
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });

  it('a missing target skips to the next step; nothing left ends the tour', () => {
    expect(stepOutcome(0, 6, true)).toEqual({ kind: 'show' });
    expect(stepOutcome(2, 6, false)).toEqual({ kind: 'goto', index: 3 });
    expect(stepOutcome(5, 6, false)).toEqual({ kind: 'finish' });
    // Walk the whole tour with steps 2 and 4 missing.
    const missing = new Set([2, 4]);
    const shown: number[] = [];
    let index = 0;
    for (;;) {
      const outcome = stepOutcome(index, 6, !missing.has(index));
      if (outcome.kind === 'finish') break;
      if (outcome.kind === 'show') {
        shown.push(index);
        const next = nextAfter(index, 6);
        if (next.kind === 'finish') break;
        index = next.index;
      } else {
        index = outcome.index;
      }
    }
    expect(shown).toEqual([0, 1, 3, 5]);
  });

  it('counter and Next/Done', () => {
    expect(stepCounter(0, 6)).toBe('1 / 6');
    expect(stepCounter(5, 6)).toBe('6 / 6');
    expect(isLastStep(4, 6)).toBe(false);
    expect(isLastStep(5, 6)).toBe(true);
    expect(nextAfter(4, 6)).toEqual({ kind: 'goto', index: 5 });
    expect(nextAfter(5, 6)).toEqual({ kind: 'finish' });
  });
});

describe('tour trigger rules (R4c)', () => {
  it('key states', () => {
    expect(tourKeyState(null)).toBe('unset');
    expect(tourKeyState('')).toBe('owed');
    expect(tourKeyState('2026-11-01T10:00:00.000Z')).toBe('done');
  });

  it('new install: nothing during setup; owed after setup → shown', () => {
    expect(decideTourOnLaunch({ hasOnboarded: false, value: null })).toBe('none');
    expect(shouldMarkOwedAfterSetup(null)).toBe(true);
    expect(decideTourOnLaunch({ hasOnboarded: true, value: '' })).toBe('show');
  });

  it('upgrade (onboarded, key missing): marked done silently, never shown', () => {
    expect(decideTourOnLaunch({ hasOnboarded: true, value: null })).toBe('mark_done_silently');
  });

  it('done: no auto-show; setup again never re-owes', () => {
    expect(decideTourOnLaunch({ hasOnboarded: true, value: '2026-11-01T10:00:00.000Z' })).toBe('none');
    expect(shouldMarkOwedAfterSetup('2026-11-01T10:00:00.000Z')).toBe(false);
    expect(shouldMarkOwedAfterSetup('')).toBe(false);
  });
});
