import { greetingFor, timeOfDay } from '../greeting';

function at(hour: number): Date {
  return new Date(2026, 9, 25, hour, 30);
}

describe('greeting', () => {
  it('maps hours to time of day', () => {
    expect(timeOfDay(at(0))).toBe('morning');
    expect(timeOfDay(at(11))).toBe('morning');
    expect(timeOfDay(at(12))).toBe('afternoon');
    expect(timeOfDay(at(16))).toBe('afternoon');
    expect(timeOfDay(at(17))).toBe('evening');
    expect(timeOfDay(at(23))).toBe('evening');
  });

  it('greets by name', () => {
    expect(greetingFor(at(9), 'QA User')).toBe('Good morning, QA User');
    expect(greetingFor(at(20), '  QA User ')).toBe('Good evening, QA User');
  });

  it('falls back to Welcome without a name', () => {
    expect(greetingFor(at(9), '')).toBe('Welcome');
    expect(greetingFor(at(9), '   ')).toBe('Welcome');
  });
});
