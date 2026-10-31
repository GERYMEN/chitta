/**
 * R4 (B1): the one place screens read the device clock. Screens never call
 * `new Date()` for "now" directly — they get it from `useNow()`, which reads
 * this, so tests can pin the time with `jest.spyOn(clock, 'now')`.
 */
export const clock = {
  now: (): Date => new Date(),
};
