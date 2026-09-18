import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

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

export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={control} {...props} />
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
