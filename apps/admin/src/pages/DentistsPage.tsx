/**
 * Врачи и их приоритет (§6): порядок меняется перетаскиванием, верхний получает запись
 * первым, если свободны несколько.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Dentist } from '@dentbook/shared';
import { useCreateDentist, useDentists, useReorderDentists } from '../api/hooks';
import { useCanManage } from '../components/Layout';
import { Badge, Button, Card, ErrorText, Input, Loading, PageHeader } from '../components/ui';
import { useI18n } from '../i18n';

function DentistRow({ dentist, position }: { dentist: Dentist; position: number }) {
  const { t } = useI18n();
  const canManage = useCanManage();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dentist.id,
    disabled: !canManage,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-md border bg-white px-3 py-2 ${
        isDragging ? 'z-10 border-teal-400 shadow-md' : 'border-slate-200'
      }`}
    >
      {canManage && (
        <button
          type="button"
          className="cursor-grab touch-none rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          aria-label={t('dentists.dragHandle')}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      )}
      <span className="w-6 text-right text-sm tabular-nums text-slate-400">{position}</span>
      <Link
        to={`/dentists/${dentist.id}`}
        className="flex-1 font-medium text-slate-900 hover:text-teal-700"
      >
        {dentist.fullName}
      </Link>
      <div className="flex flex-wrap justify-end gap-1">
        {!dentist.isActive && <Badge tone="red">{t('common.inactive')}</Badge>}
        {dentist.serviceIds.length === 0 ? (
          <Badge tone="amber">{t('dentists.noServices')}</Badge>
        ) : (
          <Badge>{t('dentists.servicesCount', { count: dentist.serviceIds.length })}</Badge>
        )}
        {dentist.telegramLinked && <Badge tone="green">Telegram</Badge>}
      </div>
    </li>
  );
}

export function DentistsPage() {
  const { t } = useI18n();
  const canManage = useCanManage();
  const dentists = useDentists();
  const reorder = useReorderDentists();
  const create = useCreateDentist();
  const [fullName, setFullName] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (dentists.isPending) return <Loading />;
  const list = dentists.data ?? [];

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = list.findIndex((d) => d.id === active.id);
    const to = list.findIndex((d) => d.id === over.id);
    reorder.mutate(arrayMove(list, from, to).map((d) => d.id));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ fullName }, { onSuccess: () => setFullName('') });
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('dentists.title')} />
      <Card>
        <p className="mb-4 text-sm text-slate-600">{t('dentists.priorityHint')}</p>
        <ErrorText error={dentists.error ?? reorder.error} />
        {list.length === 0 ? (
          <p className="text-sm text-slate-500">{t('dentists.empty')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={list.map((d) => d.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-2">
                {list.map((dentist, index) => (
                  <DentistRow key={dentist.id} dentist={dentist} position={index + 1} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      {canManage && (
        <Card title={t('dentists.add')}>
          <form className="flex flex-wrap gap-2" onSubmit={submit}>
            <Input
              className="max-w-sm flex-1"
              required
              placeholder={t('field.fullName')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <Button type="submit" disabled={create.isPending}>
              {t('common.add')}
            </Button>
          </form>
          <div className="mt-3">
            <ErrorText error={create.error} />
          </div>
        </Card>
      )}
    </div>
  );
}
