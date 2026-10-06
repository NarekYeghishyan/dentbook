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
      className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${look} ${className}`}
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

export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={control} {...props} />
);

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
