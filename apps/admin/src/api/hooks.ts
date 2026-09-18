/** Данные админки через TanStack Query. Ключи кеша — по сущностям. */
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  ApiKey,
  AvailabilityQuery,
  AvailabilityResponse,
  ClientCard,
  ClientSummary,
  ClinicSettings,
  CreateApiKeyInput,
  CreateDentistInput,
  CreateExceptionInput,
  CreateLocationInput,
  CreateServiceInput,
  CreateUserInput,
  DashboardResponse,
  Dentist,
  JournalResponse,
  Location,
  LoginInput,
  LoginResponse,
  MeResponse,
  OperatorClinic,
  OperatorMe,
  PlatformHealth,
  RegisterClinicInput,
  RescheduleInput,
  ScheduleExceptionItem,
  Service,
  StaffBookingInput,
  StaffUser,
  TelegramLink,
  UpdateApiKeyInput,
  UpdateClientInput,
  UpdateClinicInput,
  UpdateDentistInput,
  UpdateLocationInput,
  UpdateServiceInput,
  UpdateUserInput,
  VisitOutcomeInput,
  WorkingHoursInput,
  WorkingHoursItem,
} from '@dentbook/shared';
import { api } from './client';

export const keys = {
  me: ['me'] as const,
  clinic: ['clinic'] as const,
  users: ['users'] as const,
  locations: ['locations'] as const,
  services: ['services'] as const,
  dentists: ['dentists'] as const,
  hours: (dentistId: string) => ['hours', dentistId] as const,
  exceptions: (dentistId: string) => ['exceptions', dentistId] as const,
  availability: ['availability'] as const,
  apiKeys: ['api-keys'] as const,
  journal: ['journal'] as const,
  clients: ['clients'] as const,
  dashboard: ['dashboard'] as const,
};

/** Мутация, после которой перечитываются затронутые данные. */
function useSave<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  invalidate: QueryKey[],
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

// --- сессия ---

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<MeResponse>('GET', '/me'), retry: false });

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api<LoginResponse>('POST', '/auth/login', input),
    onSuccess: () => client.resetQueries(),
  });
}

export function useRegister() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterClinicInput) => api<unknown>('POST', '/auth/register', input),
    onSuccess: () => client.resetQueries(),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('POST', '/auth/logout'),
    onSuccess: () => client.clear(),
  });
}

// --- клиника и сотрудники ---

export const useUpdateClinic = () =>
  useSave(
    (input: UpdateClinicInput) => api<ClinicSettings>('PATCH', '/clinic', input),
    [keys.me, keys.availability],
  );

export const useUsers = () =>
  useQuery({ queryKey: keys.users, queryFn: () => api<StaffUser[]>('GET', '/users') });

export const useCreateUser = () =>
  useSave((input: CreateUserInput) => api<StaffUser>('POST', '/users', input), [keys.users]);

export const useUpdateUser = () =>
  useSave(
    ({ id, ...input }: UpdateUserInput & { id: string }) =>
      api<StaffUser>('PATCH', `/users/${id}`, input),
    [keys.users, keys.me],
  );

// --- филиалы и услуги ---

export const useLocations = () =>
  useQuery({ queryKey: keys.locations, queryFn: () => api<Location[]>('GET', '/locations') });

export const useCreateLocation = () =>
  useSave(
    (input: CreateLocationInput) => api<Location>('POST', '/locations', input),
    [keys.locations],
  );

export const useUpdateLocation = () =>
  useSave(
    ({ id, ...input }: UpdateLocationInput & { id: string }) =>
      api<Location>('PATCH', `/locations/${id}`, input),
    [keys.locations, keys.availability],
  );

export const useServices = () =>
  useQuery({ queryKey: keys.services, queryFn: () => api<Service[]>('GET', '/services') });

export const useCreateService = () =>
  useSave((input: CreateServiceInput) => api<Service>('POST', '/services', input), [keys.services]);

export const useUpdateService = () =>
  useSave(
    ({ id, ...input }: UpdateServiceInput & { id: string }) =>
      api<Service>('PATCH', `/services/${id}`, input),
    [keys.services, keys.availability],
  );

// --- врачи и расписание ---

export const useDentists = () =>
  useQuery({ queryKey: keys.dentists, queryFn: () => api<Dentist[]>('GET', '/dentists') });

export const useCreateDentist = () =>
  useSave((input: CreateDentistInput) => api<Dentist>('POST', '/dentists', input), [keys.dentists]);

export const useUpdateDentist = () =>
  useSave(
    ({ id, ...input }: UpdateDentistInput & { id: string }) =>
      api<Dentist>('PATCH', `/dentists/${id}`, input),
    [keys.dentists, keys.availability],
  );

export function useReorderDentists() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dentistIds: string[]) => api<Dentist[]>('PUT', '/dentists/order', { dentistIds }),
    // Порядок меняется сразу, не дожидаясь ответа: перетаскивание не должно «прыгать»
    onMutate: async (dentistIds) => {
      await client.cancelQueries({ queryKey: keys.dentists });
      const previous = client.getQueryData<Dentist[]>(keys.dentists);
      if (previous) {
        const byId = new Map(previous.map((d) => [d.id, d]));
        client.setQueryData(
          keys.dentists,
          dentistIds.map((id) => byId.get(id)).filter((d): d is Dentist => d !== undefined),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) client.setQueryData(keys.dentists, context.previous);
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.dentists }),
        client.invalidateQueries({ queryKey: keys.availability }),
      ]),
  });
}

export const useSetDentistServices = () =>
  useSave(
    ({ id, serviceIds }: { id: string; serviceIds: string[] }) =>
      api<Dentist>('PUT', `/dentists/${id}/services`, { serviceIds }),
    [keys.dentists, keys.availability],
  );

/** Ссылка привязки Telegram (§8, Q15). Не кешируется: каждая — новый одноразовый токен. */
export const useCreateTelegramLink = () =>
  useMutation({
    mutationFn: (dentistId: string) =>
      api<TelegramLink>('POST', `/dentists/${dentistId}/telegram-link`),
  });

export const useUnlinkTelegram = () =>
  useSave(
    (dentistId: string) => api<Dentist>('DELETE', `/dentists/${dentistId}/telegram`),
    [keys.dentists],
  );

export const useWorkingHours = (dentistId: string) =>
  useQuery({
    queryKey: keys.hours(dentistId),
    queryFn: () => api<WorkingHoursItem[]>('GET', `/dentists/${dentistId}/working-hours`),
  });

export const useSaveWorkingHours = (dentistId: string) =>
  useSave(
    (input: WorkingHoursInput) =>
      api<WorkingHoursItem[]>('PUT', `/dentists/${dentistId}/working-hours`, input),
    [keys.hours(dentistId), keys.availability, keys.journal],
  );

export const useExceptions = (dentistId: string, from: string, to: string) =>
  useQuery({
    queryKey: [...keys.exceptions(dentistId), from, to],
    queryFn: () =>
      api<ScheduleExceptionItem[]>(
        'GET',
        `/dentists/${dentistId}/exceptions?${new URLSearchParams({ from, to })}`,
      ),
  });

export const useCreateException = (dentistId: string) =>
  useSave(
    (input: CreateExceptionInput) =>
      api<ScheduleExceptionItem>('POST', `/dentists/${dentistId}/exceptions`, input),
    [keys.exceptions(dentistId), keys.availability, keys.journal],
  );

export const useDeleteException = (dentistId: string) =>
  useSave(
    (exceptionId: string) =>
      api<void>('DELETE', `/dentists/${dentistId}/exceptions/${exceptionId}`),
    [keys.exceptions(dentistId), keys.availability, keys.journal],
  );

// --- календарь ---

export const useAvailability = (query: AvailabilityQuery | null) =>
  useQuery({
    queryKey: [...keys.availability, query],
    queryFn: () => {
      const params = new URLSearchParams(
        Object.entries(query!).filter((e): e is [string, string] => e[1] !== undefined),
      );
      return api<AvailabilityResponse>('GET', `/availability?${params}`);
    },
    enabled: query !== null,
  });

// --- ключи формы записи ---

export const useApiKeys = () =>
  useQuery({ queryKey: keys.apiKeys, queryFn: () => api<ApiKey[]>('GET', '/api-keys') });

export const useCreateApiKey = () =>
  useSave((input: CreateApiKeyInput) => api<ApiKey>('POST', '/api-keys', input), [keys.apiKeys]);

export const useUpdateApiKey = () =>
  useSave(
    ({ id, ...input }: UpdateApiKeyInput & { id: string }) =>
      api<ApiKey>('PATCH', `/api-keys/${id}`, input),
    [keys.apiKeys],
  );

export const useRevokeApiKey = () =>
  useSave((id: string) => api<ApiKey>('POST', `/api-keys/${id}/revoke`), [keys.apiKeys]);

// --- журнал, клиенты, отчёты (Шаг 9) ---

/** После любого действия с записью журнал, клиенты, дашборд и календарь устаревают. */
const BOOKING_KEYS = [keys.journal, keys.clients, keys.dashboard, keys.availability];

export const useJournal = (query: { locationId: string; from: string; to: string } | null) =>
  useQuery({
    queryKey: [...keys.journal, query],
    queryFn: () => api<JournalResponse>('GET', `/journal?${new URLSearchParams(query!)}`),
    enabled: query !== null,
  });

export const useCreateBooking = () =>
  useSave(
    (input: StaffBookingInput) => api<{ id: string }>('POST', '/appointments', input),
    BOOKING_KEYS,
  );

export const useMoveAppointment = () =>
  useSave(
    ({ id, ...input }: RescheduleInput & { id: string }) =>
      api<void>('PATCH', `/appointments/${id}`, input),
    BOOKING_KEYS,
  );

export const useAppointmentAction = () =>
  useSave(
    ({
      id,
      action,
      ...body
    }: { id: string; action: 'confirm' | 'cancel' | 'outcome' } & Partial<VisitOutcomeInput>) =>
      api<void>('POST', `/appointments/${id}/${action}`, action === 'outcome' ? body : undefined),
    BOOKING_KEYS,
  );

export const useClients = (q: string, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.clients, 'search', q],
    queryFn: () => api<ClientSummary[]>('GET', `/clients?${new URLSearchParams(q ? { q } : {})}`),
  });

export const useClient = (id: string) =>
  useQuery({
    queryKey: [...keys.clients, id],
    queryFn: () => api<ClientCard>('GET', `/clients/${id}`),
  });

export const useUpdateClient = () =>
  useSave(
    ({ id, ...input }: UpdateClientInput & { id: string }) =>
      api<ClientCard>('PATCH', `/clients/${id}`, input),
    [keys.clients, keys.journal],
  );

export const useDashboard = (query: { from: string; to: string; locationId?: string }) =>
  useQuery({
    queryKey: [...keys.dashboard, query],
    queryFn: () =>
      api<DashboardResponse>(
        'GET',
        `/dashboard?${new URLSearchParams(
          Object.entries(query).filter((e): e is [string, string] => Boolean(e[1])),
        )}`,
      ),
  });

/** Ссылка на выгрузку CSV: скачивается браузером с cookie сессии. */
export const exportUrl = (query: { from: string; to: string; locationId?: string }) =>
  `/v1/admin/appointments/export?${new URLSearchParams(
    Object.entries(query).filter((e): e is [string, string] => Boolean(e[1])),
  )}`;

// --- панель оператора платформы (Шаг 10) ---

export const useOperatorMe = () =>
  useQuery({
    queryKey: ['operator', 'me'],
    queryFn: () => api<OperatorMe>('GET', '/operator/me'),
    retry: false,
  });

export const useOperatorClinics = () =>
  useQuery({
    queryKey: ['operator', 'clinics'],
    queryFn: () => api<OperatorClinic[]>('GET', '/operator/clinics'),
  });

export const useSetClinicStatus = () =>
  useSave(
    ({ id, status }: { id: string; status: 'active' | 'suspended' }) =>
      api<{ id: string; status: string }>('PATCH', `/operator/clinics/${id}`, { status }),
    [['operator', 'clinics']],
  );

export const usePlatformHealth = () =>
  useQuery({
    queryKey: ['operator', 'health'],
    queryFn: () => api<PlatformHealth>('GET', '/operator/health'),
    refetchInterval: 30_000,
  });
