import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney } from '@/lib/format';
import { SERIES } from '@/lib/chart';
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
  Textarea,
  Th,
  useToast,
} from '@/components/ui';
import type { BudgetYear } from '@/types';

interface BudgetForm {
  year: string;
  totalAmount: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  note: string;
}

const EMPTY: BudgetForm = {
  year: '',
  totalAmount: '',
  startDate: '',
  endDate: '',
  isActive: false,
  note: '',
};

/**
 * Composition bar for one fiscal year. The three buckets are shown side by side
 * with a 2px gap so they read as separate quantities rather than one block, and
 * each carries a visible label - the aqua fill alone would not meet contrast.
 */
function BudgetBar({ year }: { year: BudgetYear }) {
  const total = Math.max(1, year.total);
  const segments = [
    { key: 'paid', label: 'จ่ายจริง', value: year.paid, color: SERIES.blue },
    { key: 'reserved', label: 'จอง (รอจ่าย)', value: year.reserved, color: SERIES.orange },
    { key: 'available', label: 'คงเหลือ', value: Math.max(0, year.available), color: SERIES.aqua },
  ];

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="h-full rounded-full"
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: segment.color,
            }}
            title={`${segment.label} ${formatMoney(segment.value)}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {segments.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1.5 text-slate-600">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: segment.color }}
              aria-hidden="true"
            />
            {segment.label}
            <span className="font-medium tabular-nums text-slate-900">
              {formatMoney(segment.value, false)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function BudgetPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [editing, setEditing] = useState<BudgetYear | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<BudgetForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data: years, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['budget-years'],
    queryFn: () => api.get<BudgetYear[]>('/budget/years'),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        year: Number(form.year),
        totalAmount: Number(form.totalAmount),
        startDate: form.startDate,
        endDate: form.endDate,
        isActive: form.isActive,
        note: form.note || null,
      };
      if (editing) return api.put(`/budget/years/${editing.id}`, payload);
      return api.post('/budget/years', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['budget-years'] });
      await queryClient.invalidateQueries({ queryKey: ['budget-summary'] });
      toast.push('success', 'บันทึกวงเงินปีงบประมาณแล้ว');
      close();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'บันทึกไม่สำเร็จ'),
  });

  const close = () => {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY);
    setError(null);
  };

  const openCreate = () => {
    const thisYear = new Date().getFullYear() + 543;
    setForm({
      ...EMPTY,
      year: String(thisYear + 1),
      startDate: `${new Date().getFullYear()}-10-01`,
      endDate: `${new Date().getFullYear() + 1}-09-30`,
    });
    setCreating(true);
  };

  const openEdit = (year: BudgetYear) => {
    setForm({
      year: String(year.year),
      totalAmount: String(year.total),
      startDate: year.startDate.slice(0, 10),
      endDate: year.endDate.slice(0, 10),
      isActive: year.isActive,
      note: year.note ?? '',
    });
    setEditing(year);
  };

  return (
    <>
      <PageHeader
        title="งบประมาณกองทุนวิจัย"
        description="แยกยอดเป็นสามก้อน: วงเงินตั้งต้น ยอดจองจากการอนุมัติ และยอดจ่ายจริง"
        action={
          can('ADMIN') && <Button onClick={openCreate}>ตั้งวงเงินปีใหม่</Button>
        }
      />

      <Alert tone="info">
        ยอดจองถูกตัดตั้งแต่วินาทีที่ผู้มีอำนาจอนุมัติ ไม่ใช่ตอนโอนเงิน
        ทำให้ช่วงที่อนุมัติแล้วแต่ยังไม่จ่าย ตัวเลขคงเหลือไม่หลอกให้อนุมัติเกินวงเงิน
      </Alert>

      <div className="mt-5 space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : isError ? (
          <ErrorState error={loadError} onRetry={() => void refetch()} />
        ) : !years || years.length === 0 ? (
          <EmptyState
            title="ยังไม่ได้ตั้งวงเงินปีงบประมาณ"
            description="ต้องมีปีงบประมาณที่เปิดใช้งานก่อน ผู้ขอจึงจะยื่นคำขอได้"
            action={can('ADMIN') && <Button onClick={openCreate}>ตั้งวงเงินปีใหม่</Button>}
          />
        ) : (
          years.map((year) => (
            <Card
              key={year.id}
              title={
                <span className="flex items-center gap-2">
                  ปีงบประมาณ {year.year}
                  {year.isActive && (
                    <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                      เปิดใช้งาน
                    </Badge>
                  )}
                </span>
              }
              description={`${formatDate(year.startDate)} - ${formatDate(year.endDate)}`}
              action={
                can('ADMIN') && (
                  <Button variant="outline" size="sm" onClick={() => openEdit(year)}>
                    แก้ไข
                  </Button>
                )
              }
            >
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-sm text-slate-500">วงเงินตั้งต้น</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                    {formatMoney(year.total, false)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">ยอดจอง</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-amber-700">
                    {formatMoney(year.reserved, false)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">ยอดจ่ายจริง</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                    {formatMoney(year.paid, false)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">คงเหลือใช้ได้</p>
                  <p
                    className={`mt-0.5 text-lg font-bold tabular-nums ${
                      year.available <= 0 ? 'text-rose-600' : 'text-emerald-700'
                    }`}
                  >
                    {formatMoney(year.available, false)}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <BudgetBar year={year} />
              </div>

              {/* Table view of the same figures, so the numbers never depend on colour alone. */}
              <div className="mt-4">
                <Table className="min-w-0">
                  <thead>
                    <tr>
                      <Th>รายการ</Th>
                      <Th className="text-right">จำนวนเงิน (บาท)</Th>
                      <Th className="text-right">สัดส่วน</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'จ่ายจริง', value: year.paid },
                      { label: 'จอง (อนุมัติแล้วรอจ่าย)', value: year.reserved },
                      { label: 'คงเหลือใช้ได้', value: year.available },
                    ].map((row) => (
                      <tr key={row.label}>
                        <Td>{row.label}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(row.value, false)}</Td>
                        <Td className="text-right tabular-nums text-slate-500">
                          {year.total > 0 ? `${((row.value / year.total) * 100).toFixed(1)}%` : '-'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              {year.note && <p className="mt-3 text-sm text-slate-500">{year.note}</p>}
            </Card>
          ))
        )}
      </div>

      <Modal
        open={creating || Boolean(editing)}
        onClose={close}
        title={editing ? `แก้ไขวงเงินปีงบประมาณ ${editing.year}` : 'ตั้งวงเงินปีงบประมาณใหม่'}
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
            <Field label="ปีงบประมาณ (พ.ศ.)" required>
              <Input
                type="number"
                value={form.year}
                onChange={(event) => setForm({ ...form, year: event.target.value })}
              />
            </Field>
            <Field label="วงเงินตั้งต้น (บาท)" required>
              <Input
                type="number"
                min={0}
                step={1000}
                value={form.totalAmount}
                onChange={(event) => setForm({ ...form, totalAmount: event.target.value })}
              />
            </Field>
            <Field label="วันเริ่มปีงบประมาณ" required>
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              />
            </Field>
            <Field label="วันสิ้นปีงบประมาณ" required>
              <Input
                type="date"
                value={form.endDate}
                onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              />
            </Field>
          </div>
          <Checkbox
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            label="เปิดใช้งานปีนี้ (ปีที่เปิดอยู่เดิมจะถูกปิดอัตโนมัติ)"
          />
          <Field label="หมายเหตุ">
            <Textarea
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
