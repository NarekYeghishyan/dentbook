import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '@dentbook/core';
import { planReminders } from './reminders.js';

const at = (iso: string) => new Date(iso);

describe('planReminders (Step 8)', () => {
  it('plans both reminders for a visit more than a day ahead', () => {
    expect(planReminders(at('2026-10-01T14:00:00Z'), at('2026-09-28T10:00:00Z'))).toEqual([
      { kind: 'reminder_24h', at: at('2026-09-30T14:00:00Z') },
      { kind: 'reminder_2h', at: at('2026-10-01T12:00:00Z') },
    ]);
  });

  it('skips the reminders whose time has passed', () => {
    const start = at('2026-10-01T14:00:00Z');
    expect(planReminders(start, at('2026-10-01T09:00:00Z')).map((r) => r.kind)).toEqual([
      'reminder_2h',
    ]);
    expect(planReminders(start, at('2026-09-30T14:00:00Z')).map((r) => r.kind)).toEqual([
      'reminder_2h',
    ]);
    expect(planReminders(start, at('2026-10-01T12:00:00Z'))).toEqual([]);
    expect(planReminders(start, at('2026-10-01T13:30:00Z'))).toEqual([]);
  });

  it('keeps exactly 24 hours across the switch to winter time', () => {
    // В Нью-Йорке 2026-11-01 02:00 → 01:00: сутки перед визитом длятся 25 часов по часам
    const start = zonedTimeToUtc('2026-11-01', 10 * 60, 'America/New_York');
    const [day] = planReminders(start, at('2026-10-20T00:00:00Z'));
    expect(start.getTime() - day!.at.getTime()).toBe(24 * 60 * 60 * 1000);
    // По местным часам это 11:00 накануне, а не 10:00
    expect(day!.at.toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });

  it('plans a reminder for a visit just after midnight on the previous evening', () => {
    const start = zonedTimeToUtc('2026-10-02', 30, 'America/New_York');
    const [, twoHours] = planReminders(start, at('2026-09-28T00:00:00Z'));
    // 00:30 → 22:30 предыдущего дня по Нью-Йорку
    expect(twoHours!.at.toISOString()).toBe('2026-10-02T02:30:00.000Z');
  });
});
