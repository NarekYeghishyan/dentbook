/** Клиенты клиники (Шаг 9): поиск по имени и телефону, переход в карточку. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClients } from '../api/hooks';
import { useSession } from '../components/Layout';
import { Card, ErrorText, Input, Loading, PageHeader } from '../components/ui';
import { useI18n } from '../i18n';
import { formatDateTime } from '../lib/time';

export function ClientsPage() {
  const { t, locale } = useI18n();
  const { clinic } = useSession();
  const [query, setQuery] = useState('');
  const clients = useClients(query.trim());
  const when = (iso: string | null) => (iso ? formatDateTime(iso, clinic.timezone, locale) : '—');

  return (
    <div className="space-y-4">
      <PageHeader title={t('clients.title')} />
      <Input
        type="search"
        aria-label={t('clients.search')}
        placeholder={t('clients.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {clients.isPending && <Loading />}
      <ErrorText error={clients.error} />
      {clients.data?.length === 0 && <p className="text-sm text-slate-600">{t('clients.empty')}</p>}
      {clients.data && clients.data.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">{t('field.fullName')}</th>
                  <th className="py-2 pr-4 font-medium">{t('field.phone')}</th>
                  <th className="py-2 pr-4 font-medium">{t('clients.visits')}</th>
                  <th className="py-2 pr-4 font-medium">{t('clients.lastVisit')}</th>
                  <th className="py-2 font-medium">{t('clients.nextVisit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.data.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-4">
                      <Link to={`/clients/${c.id}`} className="text-teal-700 hover:underline">
                        {c.fullName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-slate-700">{c.phone}</td>
                    <td className="py-2 pr-4 text-slate-700">{c.visits}</td>
                    <td className="py-2 pr-4 text-slate-700">{when(c.lastVisitAt)}</td>
                    <td className="py-2 text-slate-700">{when(c.nextVisitAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
