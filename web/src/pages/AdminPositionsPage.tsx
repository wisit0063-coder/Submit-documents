import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, ROLE_LABELS } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
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
import type {
  PositionHandoverLog,
  PositionHandoverResult,
  PositionHolder,
  PositionStep,
} from '@/types';

/**
 * บัญชีประจำตำแหน่ง - handing a signing post to its next holder.
 *
 * Ordered by the step a claim meets, not alphabetically by account, because the
 * job is "this post changed hands", and the list of every account in the
 * university never showed that. Handing the account on rather than creating a
 * new one also matters: the claims waiting at a step are found by role and unit,
 * so a fresh account would leave that queue behind (CLAUDE.md ข้อ 19).
 */

interface HandoverForm {
  prefix: string;
  firstName: string;
  lastName: string;
  academicPosition: string;
  reason: string;
}

const EMPTY_FORM: HandoverForm = {
  prefix: '',
  firstName: '',
  lastName: '',
  academicPosition: '',
  reason: '',
};

type Target = { step: PositionStep; holder: PositionHolder };

export function AdminPositionsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [handoverTarget, setHandoverTarget] = useState<Target | null>(null);
  const [resetTarget, setResetTarget] = useState<Target | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Target | null>(null);
  const [form, setForm] = useState<HandoverForm>(EMPTY_FORM);
  const [resetReason, setResetReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Shown once. The server never hands the password back a second time, and the
  // address on a position account usually has no mailbox behind it (ข้อ 19.3),
  // so this dialog is realistically the only copy that ever exists.
  const [issued, setIssued] = useState<{ username: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['positions'],
    queryFn: () => api.get<{ steps: PositionStep[] }>('/positions'),
  });

  const history = useQuery({
    queryKey: ['position-logs', historyTarget?.holder.id],
    queryFn: () => api.get<PositionHandoverLog[]>(`/positions/${historyTarget!.holder.id}/logs`),
    enabled: Boolean(historyTarget),
  });

  function onIssued(result: PositionHandoverResult, username: string) {
    setCopied(false);
    setIssued({ username, tempPassword: result.tempPassword });
    setHandoverTarget(null);
    setResetTarget(null);
    setForm(EMPTY_FORM);
    setResetReason('');
    void queryClient.invalidateQueries({ queryKey: ['positions'] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  const handover = useMutation({
    mutationFn: (target: Target) =>
      api.post<PositionHandoverResult>(`/positions/${target.holder.id}/handover`, {
        prefix: form.prefix.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        academicPosition: form.academicPosition.trim() || null,
        reason: form.reason.trim(),
      }),
    onSuccess: (result, target) => {
      toast.push('success', 'ส่งมอบตำแหน่งแล้ว');
      onIssued(result, target.holder.username);
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'ส่งมอบตำแหน่งไม่สำเร็จ'),
  });

  const resetPassword = useMutation({
    mutationFn: (target: Target) =>
      api.post<PositionHandoverResult>(`/positions/${target.holder.id}/reset-password`, {
        reason: resetReason.trim(),
      }),
    onSuccess: (result, target) => {
      toast.push('success', 'ตั้งรหัสผ่านใหม่แล้ว');
      onIssued(result, target.holder.username);
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ'),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }
  if (isError) return <ErrorState error={loadError} onRetry={() => void refetch()} />;

  const steps = data?.steps ?? [];

  return (
    <>
      <PageHeader
        title="บัญชีประจำตำแหน่ง"
        description="ส่งมอบบัญชีของแต่ละขั้นการอนุมัติให้ผู้ดำรงตำแหน่งคนใหม่ เรียงตามลำดับที่คำขอเดินผ่าน"
      />

      <div className="space-y-4">
        <Alert tone="warning" title="การกดที่หน้านี้คือการส่งมอบสิทธิ์การลงนาม">
          รหัสผ่านของบัญชีเหล่านี้ถือเป็นการลงนามแทนลายมือชื่อบนกระดาษ การตั้งรหัสผ่านใหม่
          จึงเท่ากับมอบอำนาจลงนามของตำแหน่งนั้นให้คนใหม่ · ระบบ<strong>สุ่มรหัสให้เอง</strong>
          ผู้ดูแลระบบเลือกรหัสไม่ได้ และเจ้าของบัญชีถูกบังคับตั้งรหัสใหม่ทันทีที่เข้าสู่ระบบครั้งแรก
          · ทุกครั้งที่กด ระบบบันทึกไว้ว่าใครส่งมอบของใคร เมื่อไหร่ และเพราะอะไร <strong>ลบไม่ได้</strong>
          · เมื่อส่งมอบแล้ว ผู้ถือคนเดิมจะถูกตัดออกจากระบบทันที แม้จะยังเปิดหน้าเว็บค้างอยู่
        </Alert>

        {steps.map((step) => (
          <Card
            key={`${step.order}-${step.roleCode}`}
            title={`ขั้นที่ ${step.order} · ${step.labelTh}`}
            description={ROLE_LABELS[step.roleCode] ?? step.roleCode}
            action={
              step.waitingCount !== null && step.waitingCount > 0 ? (
                <Badge className="bg-sky-50 text-sky-700 ring-sky-200">
                  มีคำขอรออยู่ {step.waitingCount} รายการ
                </Badge>
              ) : undefined
            }
          >
            <div className="space-y-3">
{/* Asked of holders who can still sign, not of rows in the table: an
                  account that is switched off is refused at login, so a step
                  whose only holder is disabled is just as stalled as an empty
                  one - and that is the case this warning is for. */}
              {step.activeHolders === 0 && (
                <Alert tone="error" title="ขั้นนี้ไม่มีใครที่ลงนามได้">
                  {step.holders.length > 0
                    ? 'บัญชีของขั้นนี้ถูกปิดใช้งานทั้งหมด จึงล็อกอินเข้ามาลงนามไม่ได้'
                    : 'ยังไม่มีใครถือบทบาทนี้เลย'}{' '}
                  คำขอที่เดินมาถึงขั้นนี้จะค้างอยู่ตลอดไป และจะไม่ปรากฏในคิวงานของใคร
                  กรุณามอบบทบาทนี้ให้ผู้ใช้อย่างน้อย 1 คน หรือเปิดใช้งานบัญชีคืน ที่หน้า
                  &quot;ผู้ใช้งาน&quot;
                </Alert>
              )}

              {step.unitsWithoutHolder.length > 0 && (
                <Alert tone="warning" title="หน่วยงานที่ยังไม่มีผู้ลงนามในขั้นนี้">
                  {step.unitsWithoutHolder.map((unit) => unit.nameTh).join(' · ')}
                  <br />
                  คำขอจากหน่วยงานเหล่านี้จะค้างที่ขั้นนี้แบบไม่มีสัญญาณเตือน
                </Alert>
              )}

              {step.holders.length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <Th>ผู้ดำรงตำแหน่งปัจจุบัน</Th>
                      <Th>หน่วยงาน</Th>
                      <Th className="text-right">คำขอที่รออยู่</Th>
                      <Th>เข้าใช้ล่าสุด</Th>
                      <Th>ส่งมอบล่าสุด</Th>
                      <Th className="text-right">จัดการ</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {step.holders.map((holder) => (
                      <tr key={`${step.roleCode}-${holder.id}`}>
                        <Td>
                          <div className="font-medium text-slate-900">{holder.holderName}</div>
                          <div className="text-xs text-slate-500">
                            {holder.academicPosition ?? 'ไม่ระบุตำแหน่งทางวิชาการ'} ·{' '}
                            {holder.username}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {!holder.isActive && (
                              <Badge className="bg-slate-100 text-slate-600 ring-slate-200">
                                ปิดใช้งาน · ลงนามไม่ได้
                              </Badge>
                            )}
                            {holder.isAdminAccount && (
                              <Badge className="bg-indigo-50 text-indigo-700 ring-indigo-200">
                                บัญชีผู้ดูแลระบบ · ส่งมอบที่นี่ไม่ได้
                              </Badge>
                            )}
                            {holder.mustChangePassword && (
                              <Badge className="bg-amber-50 text-amber-800 ring-amber-200">
                                รอตั้งรหัสผ่านใหม่
                              </Badge>
                            )}
                            {/* Entitlement and claim history belong to a person,
                                not to a post (ข้อ 19.2): hand this account on and
                                the next holder inherits both. */}
                            {holder.holdsResearcher && holder.ownClaims > 0 && (
                              <Badge className="bg-rose-50 text-rose-700 ring-rose-200">
                                ยื่นเบิกเอง {holder.ownClaims} เรื่อง
                              </Badge>
                            )}
                          </div>
                        </Td>
                        <Td>{holder.facultyNames.join(' · ') || '—'}</Td>
                        <Td className="text-right">
                          {holder.waitingCount === null ? '—' : holder.waitingCount}
                        </Td>
                        <Td>
                          {holder.lastLoginAt ? formatDateTime(holder.lastLoginAt) : 'ยังไม่เคยเข้าใช้'}
                        </Td>
                        <Td>
                          {holder.lastHandoverAt ? formatDateTime(holder.lastHandoverAt) : '—'}
                        </Td>
                        <Td className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {/* Being an administrator is not a post that changes
                                hands, and setting the password of an account
                                that holds ADMIN would be taking over another
                                administrator - the server refuses it, so the
                                screen must not offer it either. */}
                            {holder.isAdminAccount ? (
                              <span className="self-center text-xs text-slate-500">
                                แก้ที่หน้า &quot;ผู้ใช้งาน&quot;
                              </span>
                            ) : (
                              <>
                            <Button
                              size="sm"
                              onClick={() => {
                                setError(null);
                                setForm({
                                  ...EMPTY_FORM,
                                  // Pre-filled so an administrator can see what
                                  // they are replacing, and so correcting only a
                                  // surname does not mean retyping the rest.
                                  prefix: holder.prefix ?? '',
                                  firstName: holder.firstName,
                                  lastName: holder.lastName,
                                  academicPosition: holder.academicPosition ?? '',
                                });
                                setHandoverTarget({ step, holder });
                              }}
                            >
                              ส่งมอบตำแหน่ง
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setError(null);
                                setResetReason('');
                                setResetTarget({ step, holder });
                              }}
                            >
                              ตั้งรหัสผ่านใหม่
                            </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setHistoryTarget({ step, holder })}
                            >
                              ประวัติ
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </Card>
        ))}

        <p className="text-xs text-slate-500">
          แก้คำสะกดชื่อหรือแก้อีเมลของบัญชี ทำที่หน้า &quot;ผู้ใช้งาน&quot;
          หน้านี้มีไว้สำหรับการเปลี่ยนผู้ดำรงตำแหน่งเท่านั้น เพราะการแก้ชื่อโดยไม่เปลี่ยนรหัสผ่าน
          จะได้สถานะที่อ่านว่าคนใหม่ถือตำแหน่ง แต่คนที่เข้าระบบได้จริงยังเป็นคนเดิม
        </p>
      </div>

      {/* --- ส่งมอบตำแหน่ง --- */}
      <Modal
        open={Boolean(handoverTarget)}
        onClose={() => setHandoverTarget(null)}
        title="ส่งมอบตำแหน่งให้ผู้ดำรงตำแหน่งคนใหม่"
        width="max-w-xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setHandoverTarget(null)}>
              ยกเลิก
            </Button>
            <Button
              loading={handover.isPending}
              onClick={() => handoverTarget && handover.mutate(handoverTarget)}
            >
              ส่งมอบและออกรหัสผ่านใหม่
            </Button>
          </>
        }
      >
        {handoverTarget && (
          <div className="space-y-4">
            <Alert tone="info">
              ขั้นที่ {handoverTarget.step.order} · {handoverTarget.step.labelTh}
              <br />
              ผู้ถือเดิม <strong>{handoverTarget.holder.holderName}</strong> ·{' '}
              {handoverTarget.holder.username}
            </Alert>

            {/* The reason this is safe to do at all: old paperwork does not
                change. Signatures carry the name used at the time (ข้อ 19.1). */}
            <p className="text-xs text-slate-500">
              เอกสารที่ผู้ถือเดิมอนุมัติไว้แล้วจะยังขึ้นชื่อเดิมตลอดไป ไม่เปลี่ยนตามชื่อใหม่
              เพราะระบบบันทึกชื่อผู้ลงนาม ณ วันที่กดอนุมัติไว้ในเอกสารแต่ละฉบับ
            </p>

            {handoverTarget.holder.holdsResearcher &&
              handoverTarget.holder.ownClaims > 0 && (
                <Alert tone="warning" title="บัญชีนี้เคยใช้ยื่นเบิกของตัวเอง">
                  บัญชีนี้มีคำขอของตัวเอง {handoverTarget.holder.ownClaims} เรื่อง
                  เมื่อส่งมอบแล้ว <strong>ประวัติการเบิกและสิทธิ์ 3 เรื่องต่อปีจะติดไปกับคนใหม่</strong>
                  ซึ่งอาจทำให้คนใหม่เบิกไม่ได้จนสิ้นปี · สิทธิ์การเบิกเป็นของตัวบุคคล ไม่ใช่ของตำแหน่ง
                  ควรให้ผู้ดำรงตำแหน่งใช้บัญชีส่วนตัวที่สมัครเองในการยื่นเบิก
                </Alert>
              )}

            {error && <Alert tone="error">{error}</Alert>}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="คำนำหน้าชื่อ" required hint="เช่น นาย · นาง · นางสาว · รศ.ดร.">
                <Input
                  value={form.prefix}
                  onChange={(event) => setForm({ ...form, prefix: event.target.value })}
                />
              </Field>
              <Field label="ตำแหน่งทางวิชาการ" hint="เว้นว่างได้">
                <Input
                  value={form.academicPosition}
                  onChange={(event) => setForm({ ...form, academicPosition: event.target.value })}
                />
              </Field>
              <Field label="ชื่อ" required>
                <Input
                  value={form.firstName}
                  onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                />
              </Field>
              <Field label="นามสกุล" required>
                <Input
                  value={form.lastName}
                  onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                />
              </Field>
            </div>

            <Field
              label="เหตุผล"
              required
              hint="บันทึกลงหลักฐานถาวร เช่น คำสั่งแต่งตั้งเลขที่ หรือวันที่พ้นจากตำแหน่ง"
            >
              <Textarea
                rows={3}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* --- ตั้งรหัสผ่านใหม่ให้คนเดิม --- */}
      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title="ตั้งรหัสผ่านใหม่ให้ผู้ถือคนเดิม"
        footer={
          <>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              ยกเลิก
            </Button>
            <Button
              loading={resetPassword.isPending}
              onClick={() => resetTarget && resetPassword.mutate(resetTarget)}
            >
              ออกรหัสผ่านใหม่
            </Button>
          </>
        }
      >
        {resetTarget && (
          <div className="space-y-4">
            <Alert tone="info">
              {resetTarget.holder.holderName} · {resetTarget.holder.username}
              <br />
              ชื่อผู้ถือตำแหน่งจะไม่เปลี่ยน เปลี่ยนเฉพาะรหัสผ่าน
            </Alert>
            <p className="text-xs text-slate-500">
              ใช้กรณีผู้ถือคนเดิมลืมรหัสผ่าน และอีเมลของบัญชีประจำตำแหน่งไม่มีกล่องจดหมายจริง
              จึงกดลืมรหัสผ่านเองไม่ได้
            </p>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="เหตุผล" required>
              <Textarea
                rows={3}
                value={resetReason}
                onChange={(event) => setResetReason(event.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* --- ประวัติการส่งมอบ --- */}
      <Modal
        open={Boolean(historyTarget)}
        onClose={() => setHistoryTarget(null)}
        title={`ประวัติการส่งมอบ · ${historyTarget?.holder.username ?? ''}`}
        width="max-w-2xl"
      >
        {history.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        )}
        {history.isError && <ErrorState error={history.error} onRetry={() => void history.refetch()} />}
        {history.data && history.data.length === 0 && (
          <p className="py-4 text-sm text-slate-500">
            บัญชีนี้ยังไม่เคยถูกส่งมอบหรือตั้งรหัสผ่านใหม่ผ่านหน้านี้
          </p>
        )}
        {history.data && history.data.length > 0 && (
          <ul className="divide-y divide-slate-200 text-sm">
            {history.data.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={
                      row.action === 'HANDOVER'
                        ? 'bg-brand-50 text-brand-700 ring-brand-200'
                        : 'bg-slate-100 text-slate-700 ring-slate-200'
                    }
                  >
                    {row.action === 'HANDOVER' ? 'ส่งมอบตำแหน่ง' : 'ตั้งรหัสผ่านใหม่'}
                  </Badge>
                  <span className="text-slate-500">{formatDateTime(row.createdAt)}</span>
                </div>
                {row.action === 'HANDOVER' && (
                  <p className="mt-1 text-slate-900">
                    {row.previousHolder} → <strong>{row.newHolder}</strong>
                  </p>
                )}
                <p className="mt-1 text-slate-600">เหตุผล: {row.reason}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  ดำเนินการโดย {row.actorName}
                  {row.ipAddress ? ` · ${row.ipAddress}` : ''} · บทบาทขณะนั้น: {row.rolesSnapshot}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* --- รหัสผ่านที่ออกให้ แสดงครั้งเดียว --- */}
      <Modal
        open={Boolean(issued)}
        onClose={() => setIssued(null)}
        title="รหัสผ่านชั่วคราวของบัญชีประจำตำแหน่ง"
      >
        <div className="space-y-4">
          <Alert tone="warning">
            รหัสนี้แสดงเพียงครั้งเดียว ปิดหน้าต่างนี้แล้วจะดูย้อนหลังไม่ได้
            กรุณาคัดลอกส่งให้ผู้ดำรงตำแหน่งคนใหม่ก่อนปิด
          </Alert>
          <dl className="rounded-lg bg-slate-50 p-4 text-sm">
            <dt className="text-slate-500">ชื่อผู้ใช้</dt>
            <dd className="font-mono text-slate-900">{issued?.username}</dd>
            <dt className="mt-3 text-slate-500">รหัสผ่านชั่วคราว</dt>
            <dd className="font-mono text-lg font-semibold text-slate-900">
              {issued?.tempPassword}
            </dd>
          </dl>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              if (!issued) return;
              void navigator.clipboard
                ?.writeText(
                  `ชื่อผู้ใช้: ${issued.username}\nรหัสผ่านชั่วคราว: ${issued.tempPassword}`,
                )
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกชื่อผู้ใช้และรหัสผ่าน'}
          </Button>
          <p className="text-xs text-slate-500">
            ผู้ดำรงตำแหน่งคนใหม่จะถูกบังคับตั้งรหัสผ่านของตัวเองทันทีที่เข้าสู่ระบบครั้งแรก
            ผู้ดูแลระบบจึงไม่ทราบรหัสที่ใช้ลงนามจริง
          </p>
        </div>
      </Modal>
    </>
  );
}
