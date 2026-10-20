import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
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
import { BUDGET_EDIT_ROLES } from '@/lib/access';
import type { BudgetYear, BudgetYearLog } from '@/types';

interface BudgetForm {
  reason: string;
  year: string;
  totalAmount: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  note: string;
}

const EMPTY: BudgetForm = {
  reason: '',
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
  // Reserved and paid are one bucket to the people who use this page: the
  // money left the fund when the approver signed, and nobody here records the
  // transfer (CLAUDE.md ข้อ 26). The API still reports them apart.
  const segments = [
    { key: 'used', label: 'อนุมัติแล้ว (ตัดงบ)', value: year.reserved + year.paid, color: SERIES.blue },
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

/**
 * The change history of one fund year, loaded only when opened.
 *
 * The ceiling is the single money figure a person types in, and it used to be
 * editable with nothing recorded at all. Each page view of this costs a round
 * trip to a database on the other side of the world, so it stays folded until
 * somebody asks for it.
 */
function BudgetHistory({ budgetYearId }: { budgetYearId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['budget-year-logs', budgetYearId],
    queryFn: () => api.get<BudgetYearLog[]>(`/budget/years/${budgetYearId}/logs`),
    enabled: open,
  });

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-sm font-medium text-brand-700 hover:underline"
      >
        {open ? 'ซ่อนประวัติการแก้วงเงิน' : 'ประวัติการแก้วงเงิน'}
      </button>

      {open && (
        <div className="mt-3">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner className="h-5 w-5 text-brand-600" />
            </div>
          ) : isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-slate-500">ยังไม่มีการแก้ไขที่บันทึกไว้</p>
          ) : (
            <Table className="min-w-0">
              <thead>
                <tr>
                  <Th>เมื่อ</Th>
                  <Th>ผู้ดำเนินการ</Th>
                  <Th>การเปลี่ยนแปลง</Th>
                  <Th>เหตุผล</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((log) => (
                  <tr key={log.id}>
                    <Td className="whitespace-nowrap text-slate-600">
                      {formatDateTime(log.createdAt)}
                    </Td>
                    <Td className="text-slate-800">{log.actorName}</Td>
                    <Td className="text-slate-700">
                      {log.action === 'CREATE' ? (
                        <span>ตั้งวงเงิน {formatMoney(log.newAmount, false)} บาท</span>
                      ) : (
                        <div className="space-y-0.5">
                          {log.previousAmount !== null && (
                            <p className="tabular-nums">
                              วงเงิน {formatMoney(log.previousAmount, false)} →{' '}
                              <span className="font-semibold">
                                {formatMoney(log.newAmount, false)}
                              </span>{' '}
                              บาท
                            </p>
                          )}
                          {log.newIsActive !== null && (
                            <p>{log.newIsActive ? 'เปิดใช้งานปีนี้' : 'ปิดใช้งานปีนี้'}</p>
                          )}
                        </div>
                      )}
                    </Td>
                    <Td className="text-slate-600">{log.reason || '-'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
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
      if (editing) {
        // Only sent when editing: the server demands one as soon as the figure
        // itself changes, and records it in the year's history.
        return api.put(`/budget/years/${editing.id}`, {
          ...payload,
          reason: form.reason || undefined,
        });
      }
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
      reason: '',
      year: String(year.year),
      totalAmount: String(year.total),
      startDate: year.startDate.slice(0, 10),
      endDate: year.endDate.slice(0, 10),
      isActive: year.isActive,
      note: year.note ?? '',
    });
    setEditing(year);
  };

  // Whether this edit moves the money, which is what makes a reason
  // compulsory. Comparing numbers, not strings: "1500000" and "1500000.00" are
  // the same ceiling.
  const amountChanged =
    Boolean(editing) && Number(form.totalAmount) !== Number(editing?.total ?? 0);
  const reasonMissing = amountChanged && form.reason.trim().length < 5;

  // The open year, when it is not the year today belongs to.
  const stale = (years ?? []).find((year) => year.isStale) ?? null;

  return (
    <>
      <PageHeader
        title="งบประมาณกองทุนวิจัย"
        description="วงเงินตั้งต้น ยอดที่อนุมัติแล้ว (ตัดงบ) และยอดคงเหลือ"
        action={
          can('ADMIN') && <Button onClick={openCreate}>ตั้งวงเงินปีใหม่</Button>
        }
      />

      {/* The fiscal year turns over on 1 October and nothing in the system
          notices: claims carry on being numbered from whichever year is open,
          with no error anywhere. The figure for a new year is a university
          decision with no formula, so the system says this loudly instead of
          inventing one and opening the year itself. */}
      {stale && (
        <div className="mb-4">
          <Alert tone="warning" title="ปีงบประมาณที่เปิดใช้งานไม่ตรงกับปัจจุบัน">
            <p>
              ปีงบที่เปิดใช้งานอยู่คือ <strong>{stale.year}</strong> แต่วันนี้อยู่ในปีงบประมาณ{' '}
              <strong>{stale.fiscalYearNow}</strong> แล้ว (ปีงบประมาณคือ 1 ต.ค. – 30 ก.ย.)
            </p>
            <p className="mt-1">
              คำขอที่ยื่นตั้งแต่นี้จะได้เลขที่เป็น <strong>RQ-{stale.year}-xxxx</strong> ซึ่งผิดปี
              และไปตัดวงเงินของปีที่ปิดไปแล้ว <strong>ระบบจะไม่ฟ้องอะไรเลย</strong>
            </p>
            <p className="mt-1">
              วิธีแก้: กด "ตั้งวงเงินปีใหม่" สร้างปีงบ <strong>{stale.fiscalYearNow}</strong>{' '}
              แล้วติ๊กเปิดใช้งาน ปีเก่าจะถูกปิดให้เองโดยอัตโนมัติ
            </p>
          </Alert>
        </div>
      )}

      <Alert tone="info">
        งบถูกตัดทันทีที่รองอธิการบดีกดอนุมัติ การเบิกเงินจริงทำที่กองคลังด้วยเอกสารที่ระบบพิมพ์ออก
        ถ้าคำขอที่อนุมัติแล้วถูกยกเลิกหลังอนุมัติ งบจะกลับเข้ากองทุนทันที
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
                can(...BUDGET_EDIT_ROLES) && (
                  <Button variant="outline" size="sm" onClick={() => openEdit(year)}>
                    แก้ไข
                  </Button>
                )
              }
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-sm text-slate-500">วงเงินตั้งต้น</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                    {formatMoney(year.total, false)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">อนุมัติแล้ว (ตัดงบ)</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                    {formatMoney(year.reserved + year.paid, false)}
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
                      { label: 'อนุมัติแล้ว (ตัดงบ)', value: year.reserved + year.paid },
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

              <BudgetHistory budgetYearId={year.id} />
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
            <Button
              loading={save.isPending}
              disabled={reasonMissing}
              onClick={() => save.mutate()}
            >
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
          {editing && (
            <Field
              label="เหตุผลที่แก้วงเงิน"
              hint="บังคับกรอกเมื่อยอดวงเงินเปลี่ยน อย่างน้อย 5 ตัวอักษร · จะถูกบันทึกไว้ในประวัติพร้อมชื่อผู้แก้"
              required={amountChanged}
              error={amountChanged && form.reason.trim().length < 5 ? 'กรุณาระบุเหตุผล' : undefined}
            >
              <Textarea
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
              />
            </Field>
          )}

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
