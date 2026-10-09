import { describe, expect, it } from 'vitest';
import { foldText, groupServices } from './service-search.js';

const items = [
  { name: 'Periodic exam', category: 'Diagnostic & Preventive' },
  { name: 'Crown – zirconia', category: 'Restorative' },
  { name: 'Root canal – molar', category: 'Endodontics (Root Canals)' },
  { name: 'Consultation', category: null },
  { name: 'Crown lengthening', category: 'Periodontal' },
  { name: 'Veneer – e.max', category: 'Restorative' },
];

describe('groupServices', () => {
  it('groups by category in order of first appearance, uncategorised last', () => {
    const groups = groupServices(items, '');
    expect(groups.map((g) => g.category)).toEqual([
      'Diagnostic & Preventive',
      'Restorative',
      'Endodontics (Root Canals)',
      'Periodontal',
      null,
    ]);
    expect(groups[1]!.items.map((i) => i.name)).toEqual(['Crown – zirconia', 'Veneer – e.max']);
  });

  it('matches every word in the name or the category, ignoring case and accents', () => {
    expect(groupServices(items, 'ROOT molar').flatMap((g) => g.items.map((i) => i.name))).toEqual([
      'Root canal – molar',
    ]);
    expect(groupServices(items, 'crown').flatMap((g) => g.items.map((i) => i.name))).toEqual([
      'Crown – zirconia',
      'Crown lengthening',
    ]);
    // слово из названия категории находит все услуги категории
    expect(groupServices(items, 'restorative').flatMap((g) => g.items)).toHaveLength(2);
    expect(groupServices([{ name: 'Café', category: null }], 'cafe')).toHaveLength(1);
  });

  it('returns nothing when no word matches', () => {
    expect(groupServices(items, 'implant')).toEqual([]);
  });

  it('treats blank query as no filter', () => {
    expect(groupServices(items, '   ').flatMap((g) => g.items)).toHaveLength(items.length);
  });
});

describe('foldText', () => {
  it('lowercases and strips diacritics', () => {
    expect(foldText('  Türkiye ')).toBe('turkiye');
  });
});
