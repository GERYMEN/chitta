import {
  autoReadSkipReason,
  AutoReadConditions,
  createAutoReadCoalescer,
  effectiveAutoRead,
  parseAutoReadSetting,
} from '../autoReadRules';

const GO: AutoReadConditions = {
  hasOnboarded: true,
  readGranted: true,
  receiveGranted: true,
  setting: null,
  hasActiveAccounts: true,
  windowEstimate: 3,
  largeThreshold: 500,
};

describe('auto-read setting', () => {
  it('missing = ON once RECEIVE_SMS is granted; OFF wins; no grant = off', () => {
    expect(effectiveAutoRead(null, true)).toBe(true);
    expect(effectiveAutoRead('on', true)).toBe(true);
    expect(effectiveAutoRead('off', true)).toBe(false);
    // owner's phone after the update: no grant → toggle shows OFF / "Turn on"
    expect(effectiveAutoRead(null, false)).toBe(false);
    expect(effectiveAutoRead('on', false)).toBe(false);
    expect(parseAutoReadSetting('on')).toBe('on');
    expect(parseAutoReadSetting('yes')).toBeNull();
  });
});

describe('autoReadSkipReason', () => {
  it('go', () => expect(autoReadSkipReason(GO)).toBeNull());
  it.each([
    [{ hasOnboarded: false }, 'not_onboarded'],
    [{ readGranted: false }, 'no_permission'],
    [{ receiveGranted: false }, 'no_permission'],
    [{ setting: 'off' as const }, 'turned_off'],
    [{ hasActiveAccounts: false }, 'no_accounts'],
    [{ windowEstimate: 501 }, 'large_window'],
  ])('%j → %s', (patch, reason) => {
    expect(autoReadSkipReason({ ...GO, ...patch })).toBe(reason);
  });
  it('exactly the threshold still runs; unknown estimate does not block the first check', () => {
    expect(autoReadSkipReason({ ...GO, windowEstimate: 500 })).toBeNull();
    expect(autoReadSkipReason({ ...GO, windowEstimate: null })).toBeNull();
  });
});

/** Manual fake clock + timers. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    api: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        seq += 1;
        timers.set(seq, { at: now + ms, fn });
        return seq;
      },
      clearTimeout: (h: unknown) => {
        timers.delete(h as number);
      },
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
    },
  };
}

describe('createAutoReadCoalescer', () => {
  it('runs once, DELAY after the last SMS of a burst', async () => {
    const t = fakeTimers();
    const run = jest.fn(async () => true);
    const c = createAutoReadCoalescer(run, t.api, { delayMs: 4000, maxWaitMs: 15000 });
    c.notify();
    await t.advance(1000);
    c.notify();
    await t.advance(1000);
    c.notify();
    await t.advance(3999);
    expect(run).not.toHaveBeenCalled();
    await t.advance(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(c.pending()).toBe(false);
  });

  it('a long burst still runs within maxWait of its first SMS', async () => {
    const t = fakeTimers();
    const run = jest.fn(async () => true);
    const c = createAutoReadCoalescer(run, t.api, { delayMs: 4000, maxWaitMs: 10000 });
    for (let i = 0; i < 6; i++) {
      c.notify();
      await t.advance(2000);
    }
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('single-flight: when manual Sync holds the guard, retries once, then stops', async () => {
    const t = fakeTimers();
    const run = jest.fn(async () => false); // busy every time
    const c = createAutoReadCoalescer(run, t.api, { delayMs: 1000, retryMs: 5000 });
    c.notify();
    await t.advance(1000);
    expect(run).toHaveBeenCalledTimes(1);
    await t.advance(5000);
    expect(run).toHaveBeenCalledTimes(2);
    await t.advance(60000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel drops a scheduled run', async () => {
    const t = fakeTimers();
    const run = jest.fn(async () => true);
    const c = createAutoReadCoalescer(run, t.api, { delayMs: 1000 });
    c.notify();
    c.cancel();
    await t.advance(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
