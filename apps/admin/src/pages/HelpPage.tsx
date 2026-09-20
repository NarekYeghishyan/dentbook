/**
 * Справка: кто что может в панели и как устроена работа платформы. Страница только
 * читается, запросов к API не делает; все тексты — в словарях (§9).
 */
import { useSession } from '../components/Layout';
import { Card, PageHeader } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';

const ROLES = ['owner', 'admin', 'registrar'] as const;

/** Право роли на область панели: полностью, только просмотр, нет доступа. */
type Access = 'full' | 'view' | 'none';

/**
 * Матрица прав. Источник — config роутов /v1/admin: MANAGERS (owner и admin) меняют
 * данные клиники, регистратура их только читает (ADR-0006), журнал и клиенты — общие.
 */
const ACCESS: { area: MessageKey; by: Record<(typeof ROLES)[number], Access> }[] = [
  { area: 'help.area.journal', by: { owner: 'full', admin: 'full', registrar: 'full' } },
  { area: 'help.area.clients', by: { owner: 'full', admin: 'full', registrar: 'full' } },
  { area: 'help.area.dashboard', by: { owner: 'full', admin: 'full', registrar: 'full' } },
  { area: 'help.area.export', by: { owner: 'full', admin: 'full', registrar: 'none' } },
  { area: 'help.area.catalog', by: { owner: 'full', admin: 'full', registrar: 'view' } },
  { area: 'help.area.schedule', by: { owner: 'full', admin: 'full', registrar: 'view' } },
  { area: 'help.area.website', by: { owner: 'full', admin: 'full', registrar: 'none' } },
  { area: 'help.area.staff', by: { owner: 'full', admin: 'full', registrar: 'none' } },
  { area: 'help.area.settings', by: { owner: 'full', admin: 'full', registrar: 'view' } },
];

const ACCESS_TEXT: Record<Access, MessageKey> = {
  full: 'help.access.full',
  view: 'help.access.view',
  none: 'help.access.none',
};

const SECTIONS: { title: MessageKey; text: MessageKey; extra?: MessageKey }[] = [
  { title: 'help.how.setup.title', text: 'help.how.setup.text' },
  {
    title: 'help.how.booking.title',
    text: 'help.how.booking.text',
    extra: 'help.how.booking.confirm',
  },
  {
    title: 'help.how.availability.title',
    text: 'help.how.availability.text',
    extra: 'help.how.availability.settings',
  },
  { title: 'help.how.journal.title', text: 'help.how.journal.text' },
  { title: 'help.how.telegram.title', text: 'help.how.telegram.text' },
  { title: 'help.how.sms.title', text: 'help.how.sms.text' },
];

export function HelpPage() {
  const { t } = useI18n();
  const { user } = useSession();

  return (
    <div className="space-y-6">
      <PageHeader title={t('help.title')} />

      <Card title={t('help.eachRole.title')}>
        <dl className="space-y-4 text-sm">
          {ROLES.map((role) => (
            <div key={role}>
              <dt className="font-medium text-slate-900">{t(`role.${role}` as MessageKey)}</dt>
              <dd className="mt-1 text-slate-600">{t(`help.role.${role}` as MessageKey)}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>{t('help.note.ownerProtected')}</li>
          <li>{t('help.note.selfRole')}</li>
          <li>{t('help.note.dentists')}</li>
          <li>{t('help.note.operator')}</li>
        </ul>
      </Card>

      <Card title={t('help.how.title')}>
        <div className="space-y-5 text-sm">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="font-medium text-slate-900">{t(section.title)}</h3>
              <p className="mt-1 text-slate-600">{t(section.text)}</p>
              {section.extra && <p className="mt-1 text-slate-600">{t(section.extra)}</p>}
            </section>
          ))}
        </div>
      </Card>

      <Card title={t('help.roles.title')}>
        <p className="mb-4 text-sm text-slate-600">
          {t('help.yourRole', { role: t(`role.${user.role}` as MessageKey) })}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">{t('help.roles.area')}</th>
                {ROLES.map((role) => (
                  <th key={role} className="py-2 pr-4 font-medium">
                    {t(`role.${role}` as MessageKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACCESS.map((row) => (
                <tr key={row.area} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4 text-slate-900">{t(row.area)}</td>
                  {ROLES.map((role) => (
                    <td
                      key={role}
                      className={`py-2 pr-4 ${
                        row.by[role] === 'none' ? 'text-slate-400' : 'text-slate-700'
                      }`}
                    >
                      {t(ACCESS_TEXT[row.by[role]])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
