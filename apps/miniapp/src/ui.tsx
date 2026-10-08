import { useEffect, useRef } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { maskPhone } from '@dentbook/shared/phone';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const look = {
    primary: 'bg-accent text-accent-fg',
    secondary: 'bg-card text-link',
    danger: 'bg-card text-danger',
  }[variant];
  return (
    <button
      type="button"
      className={`min-h-12 rounded-lg px-4 py-3 text-base font-medium disabled:opacity-50 ${look} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-hint">{label}</span>
      {children}
    </label>
  );
}

const control = 'w-full rounded-lg border border-hint/30 bg-bg px-3 py-2 text-fg';

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={control} {...props} />
);

/**
 * Поле телефона с маской: «2025550123» → «(202) 555-0123», «+7916…» → «+7 916 …».
 * Каретка остаётся после той же по счёту цифры, что и до форматирования.
 */
export function PhoneInput({
  value,
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      maxLength={50}
      {...props}
      value={maskPhone(value)}
      onChange={(e) => {
        const input = e.currentTarget;
        const text = maskPhone(input.value);
        const caret = input.selectionStart ?? input.value.length;
        const typed = input.value.slice(0, caret).replace(/\D/g, '').length;
        let at = 0;
        for (let seen = 0; at < text.length && seen < typed; at += 1) {
          if (/\d/.test(text[at]!)) seen += 1;
        }
        if (typed === 0) at = Math.min(caret, text.length);
        input.value = text;
        input.setSelectionRange(at, at);
        onValueChange(text);
      }}
    />
  );
}

export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={control} {...props} />
);

/**
 * Поле комментария. На iPhone диктовка с клавиатуры вставляет текст как «временный»
 * (marked text) и правит его по ходу речи; управляемое поле, которому React на каждом
 * вводе переписывает value, или нативный maxLength эту правку обрывают, и диктовка
 * молча перестаёт работать. Поэтому DOM-значением владеет само поле (defaultValue),
 * а из props оно подтягивается только когда не в фокусе; лимит режется при потере
 * фокуса и в обработчике, но не посреди ввода.
 */
export function Textarea({
  value,
  maxLength,
  onChange,
  onBlur,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'defaultValue'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = typeof value === 'string' ? value : '';
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.value !== text) el.value = text;
  }, [text]);
  const clip = (el: HTMLTextAreaElement) => {
    if (maxLength !== undefined && el.value.length > maxLength)
      el.value = el.value.slice(0, maxLength);
  };
  return (
    <textarea
      ref={ref}
      className={control}
      defaultValue={text}
      {...props}
      onChange={(e) => {
        // Пока идёт диктовка или IME, текст не трогаем: обрежем на blur
        if (!(e.nativeEvent as InputEvent).isComposing) clip(e.currentTarget);
        onChange?.(e);
      }}
      onBlur={(e) => {
        const before = e.currentTarget.value;
        clip(e.currentTarget);
        if (e.currentTarget.value !== before) onChange?.(e as never);
        onBlur?.(e);
      }}
    />
  );
}

export function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const look = tone === 'error' ? 'text-danger' : 'text-fg';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg bg-card p-3 text-sm ${look}`}
    >
      {children}
    </div>
  );
}
