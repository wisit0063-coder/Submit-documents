import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, personName } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
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
  Textarea,
  useToast,
} from '@/components/ui';
import type { BudgetSummary, Payment, PersonRef, RequestSummary } from '@/types';

interface PaymentRow extends Payment {
  request: {
    id: string;
    requestNo: string;
    articleTitle: string;
    status: string;
    calendarYear: number;
    owner: PersonRef;
    faculty: { id: string; nameTh: string };
  };
  recorder: PersonRef;
}

interface PaymentsResponse {
  pending: (RequestSummary & { budgetYear: { id: string; year: number } })[];
  paid: PaymentRow[];
}

export function PaymentsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();

  const [payTarget, setPayTarget] = useState<RequestSummary | null>(null);
  const [refundTarget, setRefundTarget] = useState<PaymentRow | null>(null);
  const [voucherNo, setVoucherNo] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showApproved, setShowApproved] = useState(false);

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.get<PaymentsResponse>('/payments'),
  });

  const { data: budget } = useQuery({
    queryKey: ['budget-summary'],
    queryFn: () => api.get<BudgetSummary>('/budget/summary'),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['payments'] });
    await queryClient.invalidateQueries({ queryKey: ['budget-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['requests'] });
  };

  const pay = useMutation({
    mutationFn: (requestId: string) =>
      api.post(`/requests/${requestId}/pay`, { voucherNo, paidAt, note: note || undefined }),
    onSuccess: async () => {
      await invalidate();
      toast.push('success', 'บันทึกผลการเบิกจ่ายเรียบร้อยแล้ว');
      setPayTarget(null);
      setVoucherNo('');
      setNote('');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'บันทึกการจ่ายไม่สำเร็จ'),
  });

  const refund = useMutation({
    mutationFn: (paymentId: string) =>
      api.post(`/payments/${paymentId}/refund`, {
        refundAmount: Number(refundAmount),
        refundReason,
      }),
    onSuccess: async () => {
      await invalidate();
      toast.push('success', 'บันทึกการเรียกเงินคืนแล้ว');
      setRefundTarget(null);
      setRefundAmount('');
      setRefundReason('');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'บันทึกการเรียกเงินคืนไม่สำเร็จ'),
  });

  const pendingTotal = (data?.pending ?? []).reduce(
    (sum, request) => sum + (request.amountApproved ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="การเบิกจ่าย"
        description="บันทึกผลการเบิกจ่ายที่กองคลังดำเนินการแล้ว ระบบไม่ได้จ่ายเงินเอง · เรื่องถือว่าจบตั้งแต่อนุมัติ การบันทึกที่นี่เป็นทางเลือก"
      />

      {budget && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-sm text-slate-500">ยอดจอง (อนุมัติแล้วรอจ่าย)</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-700">
              {formatMoney(budget.reserved, false)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-slate-500">ยอดจ่ายจริงสะสม</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
              {formatMoney(budget.paid, false)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-slate-500">คงเหลือใช้ได้</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700">
              {formatMoney(budget.available, false)}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* Folded away by default. Nobody at the university owns the job of
          recording the bursar's outcome, so an open "waiting to be paid" queue
          would only ever look like a backlog nobody is clearing. A claim is
          finished once it is approved; this list is here for the day someone
          does take the job on. */}
      <Card
        title="คำขอที่อนุมัติแล้ว"
        description={
          showApproved
            ? `${data?.pending.length ?? 0} รายการ รวม ${formatMoney(pendingTotal)} · ยังไม่ได้บันทึกผลการเบิกจ่าย ซึ่งไม่ใช่ขั้นตอนบังคับ`
            : 'เปิดดูได้เมื่อต้องการบันทึกเลขที่ฎีกากลับเข้าระบบ ไม่ใช่คิวงานที่ต้องเคลียร์'
        }
        className="mb-5"
        bodyClassName={showApproved ? 'p-5 pt-4' : 'hidden'}
        action={
          <Button size="sm" variant="outline" onClick={() => setShowApproved((value) => !value)}>
            {showApproved ? 'ซ่อนรายการ' : 'แสดงรายการ'}
          </Button>
        }
      >
        {!showApproved ? null : isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : isError ? (
          <ErrorState error={loadError} onRetry={() => void refetch()} />
        ) : !data || data.pending.length === 0 ? (
          <EmptyState title="ไม่มีคำขอที่รอการบันทึก" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>เลขที่</Th>
                <Th>ผู้รับเงิน</Th>
                <Th>บทความ</Th>
                <Th className="text-right">ยอดอนุมัติ</Th>
                <Th className="text-right">ดำเนินการ</Th>
              </tr>
            </thead>
            <tbody>
              {data.pending.map((request) => (
                <tr key={request.id} className="hover:bg-slate-50">
                  <Td>
                    <Link
                      to={`/requests/${request.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {request.requestNo}
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-slate-700">{personName(request.owner)}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {request.faculty.nameTh}
                    </span>
                  </Td>
                  <Td className="max-w-sm">
                    <span className="line-clamp-2 text-slate-800">{request.articleTitle}</span>
                  </Td>
                  <Td className="text-right font-medium tabular-nums text-emerald-700">
                    {formatMoney(request.amountApproved, false)}
                  </Td>
                  <Td className="text-right">
                    {can('FINANCE') && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setPayTarget(request);
                        }}
                      >
                        บันทึกผลเบิกจ่าย
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="ประวัติการจ่าย" description="200 รายการล่าสุด" bodyClassName="p-5 pt-4">
        {/* Same query as the card above. Its retry button covers both, so this
            one only says what happened instead of offering a second button. */}
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-slate-500">
            โหลดประวัติการจ่ายไม่สำเร็จ ดูรายละเอียดและกดลองใหม่ที่กล่องด้านบน
          </p>
        ) : !data || data.paid.length === 0 ? (
          <EmptyState title="ยังไม่มีประวัติการจ่าย" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>เลขที่ฎีกา</Th>
                <Th>คำขอ</Th>
                <Th>ผู้รับเงิน</Th>
                <Th>วันที่จ่าย</Th>
                <Th className="text-right">จำนวนเงิน</Th>
                <Th className="text-right">ดำเนินการ</Th>
              </tr>
            </thead>
            <tbody>
              {data.paid.map((payment) => (
                <tr key={payment.id} className="hover:bg-slate-50">
                  <Td className="font-medium text-slate-800">{payment.voucherNo || '-'}</Td>
                  <Td>
                    <Link
                      to={`/requests/${payment.request.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {payment.request.requestNo}
                    </Link>
                  </Td>
                  <Td>{personName(payment.request.owner)}</Td>
                  <Td>{formatDate(payment.paidAt)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatMoney(payment.amount, false)}
                    {payment.isRefunded && (
                      <Badge className="ml-2 bg-orange-50 text-orange-800 ring-orange-200">
                        คืน {formatMoney(payment.refundAmount, false)}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {!payment.isRefunded && can('FINANCE', 'ADMIN') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setError(null);
                          setRefundAmount(String(payment.amount));
                          setRefundTarget(payment);
                        }}
                      >
                        เรียกเงินคืน
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title="บันทึกผลการเบิกจ่าย"
        footer={
          <>
            <Button variant="outline" onClick={() => setPayTarget(null)}>
              ยกเลิก
            </Button>
            <Button loading={pay.isPending} onClick={() => payTarget && pay.mutate(payTarget.id)}>
              บันทึก
            </Button>
          </>
        }
      >
        {payTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {payTarget.requestNo} · {personName(payTarget.owner)} ·{' '}
              {formatMoney(payTarget.amountApproved)}
            </p>
            {error && <Alert tone="error">{error}</Alert>}
            <Field
              label="เลขที่ฎีกา"
              hint="ไม่บังคับ ถ้ายังไม่ได้รับเลขจากกองคลัง เว้นว่างไว้แล้วบันทึกเพิ่มภายหลังได้"
            >
              <Input value={voucherNo} onChange={(event) => setVoucherNo(event.target.value)} />
            </Field>
            <Field label="วันที่จ่าย" required>
              <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
            </Field>
            <Field label="หมายเหตุ">
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(refundTarget)}
        onClose={() => setRefundTarget(null)}
        title="บันทึกการเรียกเงินคืน"
        footer={
          <>
            <Button variant="outline" onClick={() => setRefundTarget(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              loading={refund.isPending}
              disabled={refundReason.trim().length < 5}
              onClick={() => refundTarget && refund.mutate(refundTarget.id)}
            >
              ยืนยันเรียกเงินคืน
            </Button>
          </>
        }
      >
        {refundTarget && (
          <div className="space-y-3">
            <Alert tone="warning">
              ใช้เมื่อตรวจพบภายหลังว่าคำขอไม่เข้าเกณฑ์ตามประกาศ ยอดที่คืนจะถูกบวกกลับเข้าวงเงินคงเหลือ
            </Alert>
            {error && <Alert tone="error">{error}</Alert>}
            <p className="text-sm text-slate-600">
              {refundTarget.request.requestNo} · จ่ายไปแล้ว {formatMoney(refundTarget.amount)}
            </p>
            <Field label="จำนวนเงินที่เรียกคืน (บาท)" required>
              <Input
                type="number"
                min={0}
                max={Number(refundTarget.amount)}
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
              />
            </Field>
            <Field label="เหตุผล" required>
              <Textarea
                value={refundReason}
                onChange={(event) => setRefundReason(event.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
