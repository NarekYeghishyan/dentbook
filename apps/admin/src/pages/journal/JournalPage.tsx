/**
 * Журнал регистратуры (Шаг 9, Q17). День — колонки врачей офиса, неделя — дни одного врача.
 * Запись перетаскивается мышью: время — по сетке шага клиники, в дневном виде — и к другому
 * врачу. Пересечения отклоняет сервер (EXCLUDE, §2.1), здесь — только понятное сообщение.
 * Сетка — по настенным часам офиса (§2.3).
 */
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useState, type MouseEvent } from 'react';
import type { JournalAppointment, JournalResponse } from '@dentbook/shared';
import {
  exportUrl,
  useDentists,
  useJournal,
  useLocations,
  useMoveAppointment,
  useServices,
} from '../../api/hooks';
import { useCanManage, useSession } from '../../components/Layout';
import { Button, Checkbox, ErrorText, Loading, PageHeader, Select } from '../../components/ui';
import { useI18n } from '../../i18n';
import {
  addDays,
  atMinutes,
  dateIn,
  formatDate,
  formatTime,
  minutesOfDay,
  mondayOf,
  todayIn,
} from '../../lib/time';
import { AppointmentDialog } from './AppointmentDialog';
import { BookingDialog, type BookingDraft } from './BookingDialog';
import { useJournalError } from './errors';
import {
  clickedMinutes,
  DAY_MIN,
  droppedMinutes,
  gridSpan,
  PX_PER_MIN,
  spanOnDate,
  type DaySpan,
} from './grid';

type View = 'day' | 'week';

interface Column {
  key: string;
  date: string;
  dentistId: string;
  title: string;
}

interface Placed<T> {
  item: T;
  span: DaySpan;
}

const STATUS_STYLE: Record<JournalAppointment['status'], string> = {
  pending: 'border-amber-400 bg-amber-50 text-amber-950',
  confirmed: 'border-teal-500 bg-teal-50 text-teal-950',
  completed: 'border-slate-400 bg-slate-100 text-slate-700',
  no_show: 'border-red-400 bg-red-50 text-red-900',
  cancelled: 'border-slate-300 bg-white text-slate-400 line-through',
};

const isMovable = (a: JournalAppointment) =>
  (a.status === 'pending' || a.status === 'confirmed') && Date.parse(a.startAt) > Date.now();

function AppointmentCard({
  placed,
  grid,
  timeZone,
  onOpen,
}: {
  placed: Placed<JournalAppointment>;
  grid: DaySpan;
  timeZone: string;
  onOpen(id: string): void;
}) {
  const { locale } = useI18n();
  const { item, span } = placed;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { appointment: item },
    disabled: !isMovable(item),
  });
  const time = formatTime(item.startAt, timeZone, locale);
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={`${time} ${item.client?.fullName ?? ''}`.trim()}
      className={`absolute inset-x-1 overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-left text-xs shadow-sm ${
        STATUS_STYLE[item.status]
      } ${isMovable(item) ? 'cursor-grab' : 'cursor-pointer'} ${isDragging ? 'z-20 opacity-80 shadow-lg' : 'z-10'}`}
      style={{
        top: (span.from - grid.from) * PX_PER_MIN,
        height: Math.max(18, (span.to - span.from) * PX_PER_MIN - 2),
        transform: CSS.Translate.toString(transform),
      }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item.id);
      }}
      {...listeners}
      {...attributes}
    >
      <span className="font-semibold">{time}</span> {item.client?.fullName}
      <span className="block truncate opacity-80">{item.service}</span>
    </button>
  );
}

function JournalColumn({
  column,
  grid,
  working,
  blocks,
  appointments,
  timeZone,
  slotStepMin,
  onOpen,
  onBook,
}: {
  column: Column;
  grid: DaySpan;
  working: DaySpan[];
  blocks: Placed<{ reason: string | null }>[];
  appointments: Placed<JournalAppointment>[];
  timeZone: string;
  slotStepMin: number;
  onOpen(id: string): void;
  onBook(draft: BookingDraft): void;
}) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: column.key, data: { column } });
  const hours = [];
  for (let m = grid.from; m < grid.to; m += 60) hours.push(m);

  function book(event: MouseEvent<HTMLDivElement>) {
    const offset = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const minutes = clickedMinutes(offset, grid.from, slotStepMin);
    if (!working.some((w) => w.from <= minutes && minutes < w.to)) return;
    onBook({ date: column.date, minutes, dentistId: column.dentistId });
  }

  return (
    <div className="min-w-40 flex-1 border-l border-slate-200">
      <div className="sticky top-0 z-30 h-10 truncate border-b border-slate-200 bg-white px-2 py-2 text-center text-sm font-medium text-slate-800">
        {column.title}
      </div>
      <div
        ref={setNodeRef}
        data-column={column.key}
        className={`relative bg-slate-100 ${isOver ? 'ring-2 ring-inset ring-teal-400' : ''}`}
        style={{ height: (grid.to - grid.from) * PX_PER_MIN }}
        onClick={book}
      >
        {working.map((w) => (
          <div
            key={`${w.from}-${w.to}`}
            className="absolute inset-x-0 cursor-copy bg-white"
            style={{ top: (w.from - grid.from) * PX_PER_MIN, height: (w.to - w.from) * PX_PER_MIN }}
          />
        ))}
        {hours.map((m) => (
          <div
            key={m}
            className="pointer-events-none absolute inset-x-0 border-t border-slate-200"
            style={{ top: (m - grid.from) * PX_PER_MIN }}
          />
        ))}
        {blocks.map(({ item, span }) => (
          <div
            key={`${span.from}-${span.to}`}
            title={item.reason ?? t('journal.closed')}
            className="absolute inset-x-0 bg-[repeating-linear-gradient(45deg,#fecaca_0,#fecaca_6px,#fee2e2_6px,#fee2e2_12px)] px-1 text-[10px] text-red-800"
            style={{
              top: (span.from - grid.from) * PX_PER_MIN,
              height: (span.to - span.from) * PX_PER_MIN,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {t('journal.closed')}
          </div>
        ))}
        {appointments.map((placed) => (
          <AppointmentCard
            key={placed.item.id}
            placed={placed}
            grid={grid}
            timeZone={timeZone}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function TimeAxis({ grid }: { grid: DaySpan }) {
  const hours = [];
  for (let m = grid.from; m < grid.to; m += 60) hours.push(m);
  return (
    <div className="w-14 shrink-0">
      <div className="h-10 border-b border-slate-200" />
      <div className="relative" style={{ height: (grid.to - grid.from) * PX_PER_MIN }}>
        {hours.map((m) => (
          <span
            key={m}
            className="absolute right-2 -translate-y-1/2 text-xs text-slate-500"
            style={{ top: (m - grid.from) * PX_PER_MIN }}
          >
            {String(m / 60).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  );
}

/** Колонки, их содержимое и высота сетки из ответа журнала. */
function layout(
  journal: JournalResponse,
  columns: Column[],
  showCancelled: boolean,
): {
  grid: DaySpan;
  cells: Map<
    string,
    {
      working: DaySpan[];
      blocks: Placed<{ reason: string | null }>[];
      appointments: Placed<JournalAppointment>[];
    }
  >;
} {
  const { timeZone } = journal;
  const cells = new Map();
  const all: DaySpan[] = [];
  const place = <T,>(item: T, start: string, end: string, date: string) => {
    const span = spanOnDate(start, end, date, timeZone);
    return span ? { item, span } : null;
  };
  for (const column of columns) {
    const dentist = journal.dentists.find((d) => d.id === column.dentistId);
    const working = (dentist?.working ?? [])
      .filter((w) => w.date === column.date)
      .map((w) => spanOnDate(w.start, w.end, column.date, timeZone))
      .filter((s): s is DaySpan => s !== null);
    const blocks = journal.blocks
      .filter((b) => b.dentistId === column.dentistId)
      .map((b) => place({ reason: b.reason }, b.startAt, b.endAt, column.date))
      .filter((p) => p !== null);
    const appointments = journal.appointments
      .filter(
        (a) =>
          a.dentistId === column.dentistId &&
          dateIn(a.startAt, timeZone) === column.date &&
          (showCancelled || a.status !== 'cancelled'),
      )
      .map((a) => place(a, a.startAt, a.endAt, column.date))
      .filter((p) => p !== null);
    all.push(...working, ...appointments.map((a) => a!.span));
    cells.set(column.key, { working, blocks, appointments });
  }
  return { grid: gridSpan(all), cells };
}

export function JournalPage() {
  const { t, locale } = useI18n();
  const { clinic } = useSession();
  const canManage = useCanManage();
  const locations = useLocations();
  const dentists = useDentists();
  const services = useServices();
  const move = useMoveAppointment();
  const errorText = useJournalError();

  const [locationId, setLocationId] = useState('');
  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState(() => todayIn(clinic.timezone));
  const [weekDentistId, setWeekDentistId] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const offices = locations.data?.filter((l) => l.isActive) ?? [];
  const office = offices.find((l) => l.id === locationId) ?? offices[0];
  const from = view === 'day' ? date : mondayOf(date);
  const to = view === 'day' ? date : addDays(from, 6);
  const journal = useJournal(office ? { locationId: office.id, from, to } : null);

  if (locations.isPending) return <Loading />;
  if (!office) {
    return (
      <>
        <PageHeader title={t('journal.title')} />
        <p className="text-sm text-slate-600">{t('journal.noOffices')}</p>
      </>
    );
  }

  const data = journal.data;
  const timeZone = data?.timeZone ?? office.timezone ?? clinic.timezone;
  const weekDentist =
    data?.dentists.find((d) => d.id === weekDentistId) ?? data?.dentists.find((d) => d.isActive);

  let columns: Column[] = [];
  if (data && view === 'day') {
    const busy = (id: string) =>
      data.dentists.find((d) => d.id === id)!.working.some((w) => w.date === date) ||
      data.appointments.some((a) => a.dentistId === id && dateIn(a.startAt, timeZone) === date);
    columns = data.dentists
      .filter((d) => busy(d.id))
      .map((d) => ({ key: `${d.id}|${date}`, date, dentistId: d.id, title: d.fullName }));
  } else if (data && weekDentist) {
    columns = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const day = addDays(from, i);
      return {
        key: `${weekDentist.id}|${day}`,
        date: day,
        dentistId: weekDentist.id,
        title: formatDate(day, locale),
      };
    });
  }
  const { grid, cells } = data
    ? layout(data, columns, showCancelled)
    : { grid: gridSpan([]), cells: new Map() };

  const step = (days: number) => setDate(addDays(date, view === 'day' ? days : days * 7));
  const selected = data?.appointments.find((a) => a.id === selectedId);

  function onDragEnd({ active, over, delta }: DragEndEvent) {
    const appointment = active.data.current?.appointment as JournalAppointment | undefined;
    const column = over?.data.current?.column as Column | undefined;
    if (!appointment || !column || !data) return;
    const oldMinutes = minutesOfDay(appointment.startAt, timeZone);
    const minutes = droppedMinutes(oldMinutes, delta.y, data.slotStepMin);
    const sameDentist = column.dentistId === appointment.dentistId;
    if (minutes < 0 || minutes >= DAY_MIN) return;
    if (
      minutes === oldMinutes &&
      sameDentist &&
      column.date === dateIn(appointment.startAt, timeZone)
    )
      return;
    setNotice(null);
    move.mutate(
      {
        id: appointment.id,
        startAt: atMinutes(column.date, minutes, timeZone),
        ...(sameDentist ? {} : { dentistId: column.dentistId }),
      },
      {
        onSuccess: () => setNotice({ error: false, text: t('journal.moved') }),
        onError: (error) => setNotice({ error: true, text: errorText(error) }),
      },
    );
  }

  const title =
    view === 'day'
      ? formatDate(date, locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : `${formatDate(from, locale)} – ${formatDate(to, locale)}`;

  return (
    <div className="space-y-4">
      <PageHeader title={t('journal.title')}>
        <div className="flex flex-wrap items-center gap-2">
          {offices.length > 1 && (
            <Select
              aria-label={t('field.office')}
              className="w-auto"
              value={office.id}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {offices.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
            {(['day', 'week'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={`px-3 py-1.5 text-sm ${view === v ? 'bg-teal-600 text-white' : 'bg-white text-slate-700'}`}
                onClick={() => setView(v)}
              >
                {t(v === 'day' ? 'journal.day' : 'journal.week')}
              </button>
            ))}
          </div>
          {view === 'week' && data && (
            <Select
              aria-label={t('field.dentist')}
              className="w-auto"
              value={weekDentist?.id ?? ''}
              onChange={(e) => setWeekDentistId(e.target.value)}
            >
              {data.dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          )}
          <Button variant="secondary" aria-label={t('journal.prev')} onClick={() => step(-1)}>
            ‹
          </Button>
          <Button variant="secondary" onClick={() => setDate(todayIn(timeZone))}>
            {t('journal.today')}
          </Button>
          <Button variant="secondary" aria-label={t('journal.next')} onClick={() => step(1)}>
            ›
          </Button>
          <Button
            disabled={!data || columns.length === 0}
            onClick={() =>
              setDraft({
                date: columns[0]?.date ?? date,
                minutes: grid.from,
                dentistId: columns[0]?.dentistId ?? '',
              })
            }
          >
            {t('journal.newBooking')}
          </Button>
          {canManage && (
            <a
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              href={exportUrl({ from, to, locationId: office.id })}
            >
              {t('journal.export')}
            </a>
          )}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-medium text-slate-900">{title}</p>
        <Checkbox
          label={t('journal.showCancelled')}
          checked={showCancelled}
          onChange={setShowCancelled}
        />
      </div>
      <p className="text-xs text-slate-500">
        {t('journal.hint')} {t('calendar.timezone', { zone: timeZone })}
      </p>
      {notice && (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={`rounded-md px-3 py-2 text-sm ${notice.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}
        >
          {notice.text}
        </p>
      )}

      {journal.isPending && <Loading />}
      <ErrorText error={journal.error} />
      {data && columns.length === 0 && (
        <p className="text-sm text-slate-600">{t('journal.noDentists')}</p>
      )}
      {data && columns.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
          <div className="flex max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
            <TimeAxis grid={grid} />
            {columns.map((column) => (
              <JournalColumn
                key={column.key}
                column={column}
                grid={grid}
                {...cells.get(column.key)!}
                timeZone={timeZone}
                slotStepMin={data.slotStepMin}
                onOpen={setSelectedId}
                onBook={setDraft}
              />
            ))}
          </div>
        </DndContext>
      )}

      {selected && (
        <AppointmentDialog
          appointment={selected}
          dentistName={data?.dentists.find((d) => d.id === selected.dentistId)?.fullName ?? ''}
          timeZone={timeZone}
          onClose={() => setSelectedId(null)}
          onDone={() => setSelectedId(null)}
        />
      )}
      {draft && data && dentists.data && services.data && (
        <BookingDialog
          draft={draft}
          locationId={office.id}
          timeZone={timeZone}
          slotStepMin={data.slotStepMin}
          dentists={dentists.data}
          services={services.data}
          onClose={() => setDraft(null)}
          onDone={() => {
            setDraft(null);
            setNotice({ error: false, text: t('booking.created') });
          }}
        />
      )}
    </div>
  );
}
