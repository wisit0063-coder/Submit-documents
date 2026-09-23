import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Table,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import type { JournalTier } from '@/types';

interface TierForm {
  code: string;
  nameTh: string;
  databaseName: string;
  quartile: string;
  rateNormal: string;
  rateConference: string;
  announcementRef: string;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY: TierForm = {
  code: '',
  nameTh: '',
  databaseName: '',
  quartile: '',
  rateNormal: '',
  rateConference: '',
  announcementRef: '2131/2566',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '',
  isActive: true,
  sortOrder: '0',
};

/**
 * Rates live in journal_tiers, never in code, because the announcement changes.
 * A closed database (ACI, since December 2024) is deactivated rather than
 * deleted so historical requests keep resolving their tier.
 */
export function AdminTiersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<JournalTier | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TierForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data: tiers, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['journal-tiers', 'all'],
    queryFn: () => api.get<JournalTier[]>('/journal-tiers', { includeInactive: true }),
  });

  const close = () => {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY);
    setError(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code,
        nameTh: form.nameTh,
        databaseName: form.databaseName,
        quartile: form.quartile || null,
        rateNormal: Number(form.rateNormal),
        rateConference: Number(form.rateConference),
        announcementRef: form.announcementRef || null,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder),
      };
      if (editing) return api.put(`/journal-tiers/${editing.id}`, payload);
      return api.post('/journal-tiers', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['journal-tiers'] });
      toast.push('success', 'บันทึกอัตราค่าตอบแทนแล้ว');
      close();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'บันทึกไม่สำเร็จ'),
  });

  const openEdit = (tier: JournalTier) => {
    setForm({
      code: tier.code,
      nameTh: tier.nameTh,
      databaseName: tier.databaseName,
      quartile: tier.quartile ?? '',
      rateNormal: String(tier.rateNormal),
      rateConference: String(tier.rateConference),
      announcementRef: tier.announcementRef ?? '',
      effectiveFrom: tier.effectiveFrom.slice(0, 10),
      effectiveTo: tier.effectiveTo ? tier.effectiveTo.slice(0, 10) : '',
      isActive: tier.isActive,
      sortOrder: String(tier.sortOrder),
    });
    setEditing(tier);
  };

  return (
    <>
      <PageHeader
        title="อัตราค่าตอบแทนตามประเภทวารสาร"
        description="ตามประกาศมหาวิทยาลัยราชภัฏชัยภูมิ เลขที่ 2131/2566"
        action={
          <Button
            onClick={() => {
              setForm(EMPTY);
              setCreating(true);
            }}
          >
            เพิ่มอัตราใหม่
          </Button>
        }
      />

      <Alert tone="info">
        เมื่อมีประกาศใหม่ ให้เพิ่มรายการใหม่แล้วปิดใช้งานรายการเดิม อย่าลบทิ้ง
        เพราะคำขอที่ยื่นไปแล้วยังอ้างอิงอัตราเดิมอยู่
      </Alert>

      <Card className="mt-5" bodyClassName="p-5 pt-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : isError ? (
          <ErrorState error={loadError} onRetry={() => void refetch()} />
        ) : !tiers || tiers.length === 0 ? (
          <EmptyState title="ยังไม่มีอัตราค่าตอบแทนในระบบ" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>รหัส</Th>
                <Th>ประเภทวารสาร</Th>
                <Th className="text-right">อัตราปกติ</Th>
                <Th className="text-right">คัดเลือกจาก conference</Th>
                <Th>มีผลตั้งแต่</Th>
                <Th className="text-right">สถานะ</Th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id} className={tier.isActive ? 'hover:bg-slate-50' : 'bg-slate-50/60'}>
                  <Td>
                    <button
                      type="button"
                      onClick={() => openEdit(tier)}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {tier.code}
                    </button>
                  </Td>
                  <Td>
                    <span className={tier.isActive ? 'text-slate-800' : 'text-slate-500'}>
                      {tier.nameTh}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{tier.databaseName}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(tier.rateNormal, false)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(tier.rateConference, false)}</Td>
                  <Td className="text-xs text-slate-500">
                    {formatDate(tier.effectiveFrom)}
                    {tier.effectiveTo && ` - ${formatDate(tier.effectiveTo)}`}
                  </Td>
                  <Td className="text-right">
                    {tier.isActive ? (
                      <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                        เปิดใช้งาน
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500 ring-slate-200">ปิดรับแล้ว</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={creating || Boolean(editing)}
        onClose={close}
        title={editing ? `แก้ไขอัตรา ${editing.code}` : 'เพิ่มอัตราค่าตอบแทนใหม่'}
        width="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={close}>
              ยกเลิก
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              บันทึก
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="รหัส" hint="ตัวพิมพ์ใหญ่และขีดล่าง เช่น SCOPUS_Q1" required>
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                disabled={Boolean(editing)}
              />
            </Field>
            <Field label="ชื่อประเภทวารสาร (ไทย)" required>
              <Input
                value={form.nameTh}
                onChange={(event) => setForm({ ...form, nameTh: event.target.value })}
              />
            </Field>
            <Field label="ชื่อฐานข้อมูล" required>
              <Input
                value={form.databaseName}
                onChange={(event) => setForm({ ...form, databaseName: event.target.value })}
                placeholder="Scopus / Web of Science / TCI"
              />
            </Field>
            <Field label="ควอไทล์">
              <Input
                value={form.quartile}
                onChange={(event) => setForm({ ...form, quartile: event.target.value })}
                placeholder="Q1"
              />
            </Field>
            <Field label="อัตราปกติ (บาท)" required>
              <Input
                type="number"
                min={0}
                step={500}
                value={form.rateNormal}
                onChange={(event) => setForm({ ...form, rateNormal: event.target.value })}
              />
            </Field>
            <Field label="อัตราคัดเลือกจาก conference (บาท)" required>
              <Input
                type="number"
                min={0}
                step={500}
                value={form.rateConference}
                onChange={(event) => setForm({ ...form, rateConference: event.target.value })}
              />
            </Field>
            <Field label="อ้างอิงประกาศเลขที่">
              <Input
                value={form.announcementRef}
                onChange={(event) => setForm({ ...form, announcementRef: event.target.value })}
              />
            </Field>
            <Field label="ลำดับการแสดงผล">
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
              />
            </Field>
            <Field label="มีผลตั้งแต่" required>
              <Input
                type="date"
                value={form.effectiveFrom}
                onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
              />
            </Field>
            <Field label="สิ้นสุดวันที่" hint="เว้นว่างหากยังใช้อยู่">
              <Input
                type="date"
                value={form.effectiveTo}
                onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}
              />
            </Field>
          </div>
          <Checkbox
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            label="เปิดให้เลือกในแบบฟอร์มยื่นคำขอ"
          />
        </div>
      </Modal>
    </>
  );
}
