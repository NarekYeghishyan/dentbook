import { NUMBER_FORMATS } from './countries.js';

/**
 * Телефон клиента → E.164. Клиники в США (Q5): 10 цифр — номер США, 11 с ведущей 1 —
 * тоже; номер другой страны вводится с «+».
 */
export function toE164(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/**
 * Номер из поля с выбором страны (виджет, Шаг 6): `dialCode` — код выбранной страны,
 * `input` — то, что набрал клиент.
 *
 * Международный ввод сильнее выбора в списке: «+» и «00» разбираются как есть. Иначе это
 * национальная часть, и ведущий ноль — внутренний префикс выхода на межгород, в E.164 его
 * нет (мобильные номера Италии, единственного заметного исключения, начинаются с 3).
 */
export function toE164In(dialCode: string, input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) return toE164(trimmed);
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) return toE164(`+${digits.slice(2)}`);
  const dial = dialCode.replace(/\D/g, '');
  // Код NANP клиенты часто набирают без «+»: код зоны там начинается с 2–9, так что
  // ведущая единица — всегда код страны. Для остальных стран не угадываем.
  const national =
    dial === '1' && digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits.replace(/^0+/, '');
  return national.length === 0 ? null : toE164(`+${dial}${national}`);
}

/**
 * Номер по шаблону страны для поля ввода: «2025550123» → «(202) 555-0123».
 * `null` — для этого кода страны шаблона нет, тогда номер показываем как введён.
 *
 * Цифры не теряются: лишние дописываются в конец, а ведущая единица NANP и ведущий ноль
 * национального набора остаются перед номером — шаблон применяется к остатку.
 */
export function maskNational(dialCode: string, input: string): string | null {
  const dial = dialCode.replace(/\D/g, '');
  const pattern = NUMBER_FORMATS[dial];
  if (pattern === undefined) return null;
  const digits = input.replace(/\D/g, '');
  if (digits === '') return '';
  let prefix = '';
  let rest = digits;
  if (dial === '1' ? digits.length > 10 && digits.startsWith('1') : digits.startsWith('0')) {
    prefix = dial === '1' ? '1 ' : '0';
    rest = digits.slice(1);
  }
  let out = '';
  let taken = 0;
  let separator = '';
  for (const char of pattern) {
    if (taken >= rest.length) break;
    if (char !== '#') {
      // разделитель показываем только перед следующей цифрой, иначе его не стереть
      separator += char;
      continue;
    }
    out += separator + rest[taken];
    separator = '';
    taken += 1;
  }
  return prefix + out + rest.slice(taken);
}
