/**
 * Ключи формы записи для сайта клиники (§2.5): ключ pk_, сайты, с которых он работает,
 * и готовый код встраивания формы (Шаг 6).
 */
import { useState, type FormEvent } from 'react';
import type { ApiKey } from '@dentbook/shared';
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useUpdateApiKey } from '../api/hooks';
import { useSession } from '../components/Layout';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
} from '../components/ui';
import { useI18n } from '../i18n';
import { formatDateTime } from '../lib/time';

/** Код для сайта клиники: скрипт формы отдаёт тот же домен, что и панель (Q14). */
const embedCode = (token: string) =>
  [
    '<div id="dentbook-booking"></div>',
    `<script src="${window.location.origin}/widget/dentbook-widget.js" data-key="${token}" data-target="#dentbook-booking" async></script>`,
  ].join('\n');

/** Сайты вводятся через запятую или с новой строки. */
const parseOrigins = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

function KeyRow({ apiKey }: { apiKey: ApiKey }) {
  const { t, locale } = useI18n();
  const { clinic } = useSession();
  const update = useUpdateApiKey();
  const revoke = useRevokeApiKey();
  const [origins, setOrigins] = useState(apiKey.allowedOrigins.join('\n'));
  const [copied, setCopied] = useState<'key' | 'code' | null>(null);
  const revoked = apiKey.revokedAt !== null;

  async function copy(what: 'key' | 'code') {
    await navigator.clipboard.writeText(what === 'key' ? apiKey.token : embedCode(apiKey.token));
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 font-medium text-slate-900">{apiKey.name}</p>
        {revoked ? (
          <Badge tone="red">{t('website.revoked')}</Badge>
        ) : (
          apiKey.lastUsedAt && (
            <span className="text-xs text-slate-500">
              {t('website.lastUsed', {
                time: formatDateTime(apiKey.lastUsedAt, clinic.timezone, locale),
              })}
            </span>
          )
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <code className="flex-1 break-all rounded bg-slate-100 px-2 py-1.5 text-xs text-slate-700">
          {apiKey.token}
        </code>
        {!revoked && (
          <Button variant="secondary" onClick={() => void copy('key')}>
            {copied === 'key' ? t('website.copied') : t('website.copy')}
          </Button>
        )}
      </div>
      {!revoked && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">{t('website.snippet')}</p>
          <pre className="overflow-x-auto rounded bg-slate-900 px-3 py-2 text-xs text-slate-100">
            {embedCode(apiKey.token)}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void copy('code')}>
              {copied === 'code' ? t('website.copied') : t('website.copyCode')}
            </Button>
            <span className="text-xs text-slate-500">{t('website.snippetHint')}</span>
          </div>
        </div>
      )}
      {!revoked && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id: apiKey.id, allowedOrigins: parseOrigins(origins) });
          }}
        >
          <Field label={t('website.origins')} hint={t('website.originsHint')}>
            <textarea
              rows={2}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
            />
          </Field>
          <ErrorText error={update.error ?? revoke.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" disabled={update.isPending}>
              {t('common.save')}
            </Button>
            <Button
              variant="danger"
              disabled={revoke.isPending}
              onClick={() => {
                if (window.confirm(t('website.revokeConfirm'))) revoke.mutate(apiKey.id);
              }}
            >
              {t('website.revoke')}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

export function WebsitePage() {
  const { t } = useI18n();
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name, allowedOrigins: parseOrigins(origins) },
      {
        onSuccess: () => {
          setName('');
          setOrigins('');
        },
      },
    );
  }

  if (keys.isPending) return <Loading />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('website.title')} />
      <Card>
        <p className="mb-2 text-sm text-slate-600">{t('website.intro')}</p>
        <ErrorText error={keys.error} />
        {keys.data?.length === 0 && <p className="text-sm text-slate-500">{t('website.empty')}</p>}
        <ul className="divide-y divide-slate-100">
          {keys.data?.map((apiKey) => (
            <KeyRow key={apiKey.id} apiKey={apiKey} />
          ))}
        </ul>
      </Card>
      <Card title={t('website.add')}>
        <form className="space-y-4" onSubmit={submit}>
          <Field label={t('field.name')}>
            <Input
              required
              placeholder={t('website.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('website.origins')} hint={t('website.originsHint')}>
            <textarea
              required
              rows={2}
              placeholder="https://example.com"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
            />
          </Field>
          <ErrorText error={create.error} />
          <Button type="submit" disabled={create.isPending}>
            {t('website.create')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
