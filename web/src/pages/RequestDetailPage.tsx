import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  personName,
  signerName,
  STATUS_LABELS,
  STATUS_TONE,
  STEP_LABELS,
  thaiYear,
  WORKFLOW_ORDER,
} from '@/lib/format';
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
  Textarea,
  useToast,
  cn,
} from '@/components/ui';
import { AttachmentPanel } from '@/components/AttachmentPanel';
import type { RequestDetail, RequestStatus, TimelineEntry } from '@/types';

/** Which role owns each review status - mirrors config/workflow.ts on the server. */
const STEP_OWNER: Partial<Record<RequestStatus, string>> = {
  FACULTY_REVIEW: 'FACULTY_QA',
  DEAN_REVIEW: 'DEAN',
  RDI_REVIEW: 'RDI_OFFICER',
  ACADEMIC_OFFICE_REVIEW: 'ACADEMIC_OFFICE',
  COMMITTEE_REVIEW: 'RDI_OFFICER',
  PENDING_APPROVAL: 'APPROVER',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5 text-sm sm:grid-cols-4">
      <dt className="col-span-1 text-slate-500">{label}</dt>
      <dd className="col-span-2 text-slate-900 sm:col-span-3">{children ?? '-'}</dd>
    </div>
  );
}

/** Horizontal rail of the happy path, with the current step marked. */
function ProgressRail({ status }: { status: RequestStatus }) {
  const offPath = ['RETURNED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'COMMITTEE_REVIEW'].includes(status);
  const currentIndex = WORKFLOW_ORDER.indexOf(status);

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {WORKFLOW_ORDER.map((step, index) => {
        const done = !offPath && currentIndex > index;
        const current = !offPath && currentIndex === index;
        return (
          <div key={step} className="flex items-center gap-1">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
                current && 'bg-brand-600 text-white ring-brand-600',
                done && 'bg-brand-50 text-brand-700 ring-brand-200',
                !current && !done && 'bg-slate-50 text-slate-400 ring-slate-200',
              )}
            >
              {STATUS_LABELS[step]}
            </span>
            {index < WORKFLOW_ORDER.length - 1 && (
              <span className={cn('h-px w-3', done ? 'bg-brand-300' : 'bg-slate-200')} />
            )}
          </div>
        );
      })}
      {offPath && (
        <Badge className={cn('ml-2', STATUS_TONE[status])}>{STATUS_LABELS[status]}</Badge>
      )}
    </div>
  );
}

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user, can } = useAuth();

  const [dialog, setDialog] = useState<
    | null
    | 'submit'
    | 'approve'
    | 'return'
    | 'reject'
    | 'final'
    | 'committee'
    | 'pay'
    | 'cancel'
    | 'qa-year'
  >(null);
  const [qaYear, setQaYear] = useState('');
  const [comment, setComment] = useState('');
  const [missingDocuments, setMissingDocuments] = useState('');
  const [amountApproved, setAmountApproved] = useState('');
  const [voucherNo, setVoucherNo] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [isFirstAuthor, setIsFirstAuthor] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ code: string; message: string }[]>([]);

  const {
    data: request,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['request', id],
    queryFn: () => api.get<RequestDetail>(`/requests/${id}`),
    enabled: Boolean(id),
  });

  const { data: timeline } = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => api.get<TimelineEntry[]>(`/requests/${id}/timeline`),
    enabled: Boolean(id),
  });

  const closeDialog = () => {
    setDialog(null);
    setActionError(null);
    setIssues([]);
    setComment('');
    setMissingDocuments('');
  };

  const afterAction = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ['request', id] });
    await queryClient.invalidateQueries({ queryKey: ['timeline', id] });
    await queryClient.invalidateQueries({ queryKey: ['inbox'] });
    await queryClient.invalidateQueries({ queryKey: ['inbox-count'] });
    await queryClient.invalidateQueries({ queryKey: ['requests'] });
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    toast.push('success', message);
    closeDialog();
  };

  const handleError = (caught: unknown) => {
    if (caught instanceof ApiError) {
      setActionError(caught.message);
      setIssues(caught.issues);
    } else {
      setActionError('ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const action = useMutation({
    mutationFn: async (variables: {
      path: string;
      body?: unknown;
      method?: 'post' | 'patch' | 'delete';
    }) => {
      if (variables.method === 'delete') return api.delete(variables.path);
      if (variables.method === 'patch') return api.patch(variables.path, variables.body);
      return api.post(variables.path, variables.body);
    },
    onError: handleError,
  });

  // A 403 or 404 used to leave this spinner turning for ever: `request` never
  // arrives, so `!request` stayed true. The error now gets its own screen.
  if (isError) {
    return (
      <div className="py-10">
        <ErrorState error={error} onRetry={() => void refetch()} />
        <div className="mt-4 text-center">
          <Link to="/requests" className="text-sm text-brand-700 hover:underline">
            กลับไปหน้ารายการคำขอ
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !request) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-7 w-7 text-brand-600" />
      </div>
    );
  }

  const isOwner = user?.id === request.userId;
  const stepRole = STEP_OWNER[request.status];
  // Nobody reviews their own request, at any step.
  const canReview = Boolean(stepRole && !isOwner && can(stepRole as never));
  const canEditDraft = isOwner && ['DRAFT', 'RETURNED'].includes(request.status);
  const canCancel =
    isOwner &&
    ['DRAFT', 'FACULTY_REVIEW', 'DEAN_REVIEW', 'RDI_REVIEW', 'ACADEMIC_OFFICE_REVIEW', 'COMMITTEE_REVIEW', 'RETURNED'].includes(
      request.status,
    );
  const canPay = can('FINANCE') && request.status === 'APPROVED';

  // Mirrors setQaIndicatorYear on the server - FACULTY_QA of this request's
  // faculty (or one granted without a faculty), or ADMIN. The server checks
  // again; this only decides whether to offer the button. Any status after
  // submission, because the QA return is usually compiled once claims are paid.
  const canSetQaYear =
    request.status !== 'DRAFT' &&
    (can('ADMIN') ||
      (user?.roleScopes ?? []).some(
        (scope) =>
          scope.roleCode === 'FACULTY_QA' &&
          (scope.facultyId === null || scope.facultyId === request.facultyId),
      ));

  /** QA rounds are counted in พ.ศ.; default to the year the article was published. */
  const defaultQaYear = String(request.qaIndicatorYear ?? thaiYear(request.calendarYear));

  const lastReturn = [...(request.approvals ?? [])]
    .reverse()
    .find((approval) => approval.decision === 'RETURNED');

  const run = (path: string, body?: unknown, message = 'ดำเนินการเรียบร้อยแล้ว') =>
    action.mutate(
      { path, body },
      { onSuccess: () => void afterAction(message) },
    );

  return (
    <>
      <PageHeader
        title={request.requestNo}
        description={`ยื่นเมื่อ ${formatDateTime(request.submittedAt) } · ปีปฏิทิน ${thaiYear(request.calendarYear)}`}
        action={
          <div className="flex flex-wrap gap-2 no-print">
            <a href={api.fileUrl(`/requests/${request.id}/document`)} target="_blank" rel="noreferrer">
              <Button variant="outline">พิมพ์บันทึกข้อความ (PDF)</Button>
            </a>
            {/* The voucher is what the claimant signs for the money, so it
                only exists once an amount has been approved. */}
            {request.amountApproved !== null && (
              <a
                href={api.fileUrl(`/requests/${request.id}/receipt`)}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="outline">พิมพ์ใบสำคัญรับเงิน (PDF)</Button>
              </a>
            )}
            {canEditDraft && (
              <Link to={`/requests/${request.id}/edit`}>
                <Button variant="outline">แก้ไข</Button>
              </Link>
            )}
            {isOwner && request.status === 'DRAFT' && (
              <Button onClick={() => setDialog('submit')}>ส่งคำขอ</Button>
            )}
            {isOwner && request.status === 'RETURNED' && (
              <Button onClick={() => setDialog('submit')}>ส่งกลับเข้าพิจารณา</Button>
            )}
          </div>
        }
      />

      <Card className="mb-5" bodyClassName="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge className={cn('text-sm', STATUS_TONE[request.status])}>
            {STATUS_LABELS[request.status]}
          </Badge>
          <span className="text-sm text-slate-500">
            {request.sequenceInYear
              ? `ใช้สิทธิ์ลำดับที่ ${request.sequenceInYear} จาก 3 เรื่องของปีที่ยื่น ${thaiYear(
                  request.entitlementYear ?? request.calendarYear,
                )}`
              : 'ยังไม่ได้ตัดสิทธิ์ประจำปี (ตัดเมื่ออนุมัติ)'}
          </span>
        </div>
        <div className="mt-3">
          <ProgressRail status={request.status} />
        </div>
      </Card>

      {request.status === 'RETURNED' && lastReturn && (
        <div className="mb-5">
          <Alert tone="warning" title="คำขอถูกตีกลับให้แก้ไข">
            <p>
              จากขั้น {STEP_LABELS[lastReturn.stepCode] ?? lastReturn.stepCode} โดย{' '}
              {signerName(lastReturn)} เมื่อ {formatDateTime(lastReturn.signedAt)}
            </p>
            <p className="mt-1 font-medium">สิ่งที่ต้องแก้ไข: {lastReturn.missingDocuments}</p>
            {lastReturn.comment && <p className="mt-1">ความเห็นเพิ่มเติม: {lastReturn.comment}</p>}
            <p className="mt-2 text-xs">
              เมื่อแก้ไขแล้วกดส่งกลับ ระบบจะส่งเรื่องกลับเข้าขั้นที่ตีกลับ ไม่ต้องเริ่มกระบวนการใหม่
            </p>
          </Alert>
        </div>
      )}

      {canReview && (
        <Card className="mb-5 no-print" title="การพิจารณาของคุณ" description={`ขั้นตอน: ${STATUS_LABELS[request.status]}`}>
          <div className="flex flex-wrap gap-2">
            {request.status === 'PENDING_APPROVAL' ? (
              <>
                <Button
                  variant="success"
                  onClick={() => {
                    setAmountApproved(String(request.amountRequested));
                    setDialog('final');
                  }}
                >
                  อนุมัติและระบุจำนวนเงิน
                </Button>
                <Button variant="danger" onClick={() => setDialog('reject')}>
                  ไม่อนุมัติ
                </Button>
              </>
            ) : (
              <Button
                variant="success"
                onClick={() => {
                  setQaYear(defaultQaYear);
                  setDialog('approve');
                }}
              >
                เห็นชอบ ส่งต่อขั้นถัดไป
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialog('return')}>
              ตีกลับให้แก้ไข
            </Button>
            {request.status === 'RDI_REVIEW' && (
              <Button variant="outline" onClick={() => setDialog('committee')}>
                ส่งเข้าคณะกรรมการ
              </Button>
            )}
          </div>
        </Card>
      )}

      {canPay && (
        <Card className="mb-5 no-print" title="การเบิกจ่าย">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-600">
              อนุมัติแล้ว {formatMoney(request.amountApproved)} · บันทึกผลการเบิกจ่ายได้เมื่อตั้งเบิกที่กองคลังเสร็จ
              ไม่ใช่ขั้นบังคับ
            </p>
            <Button onClick={() => setDialog('pay')}>บันทึกผลการเบิกจ่าย</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="ข้อมูลบทความ">
            <dl className="divide-y divide-slate-100">
              <DetailRow label="ชื่อบทความ">{request.articleTitle}</DetailRow>
              <DetailRow label="วารสาร">{request.journalName}</DetailRow>
              <DetailRow label="ปีที่ / ฉบับ / หน้า">
                {[request.volume, request.issue, request.pages].filter(Boolean).join(' / ') || '-'}
              </DetailRow>
              <DetailRow label="ISSN">{request.issn || '-'}</DetailRow>
              <DetailRow label="DOI">
                {request.doi ? (
                  <a
                    href={`https://doi.org/${request.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-700 hover:underline"
                  >
                    {request.doi}
                  </a>
                ) : (
                  '-'
                )}
              </DetailRow>
              <DetailRow label="วันที่ตีพิมพ์">{formatDate(request.publishedAt)}</DetailRow>
              <DetailRow label="ฐานข้อมูล">
                {request.journalTier.nameTh}
                {request.fromConference && ' (คัดเลือกจาก conference)'}
              </DetailRow>
              <DetailRow label="ยอดที่ขอ">{formatMoney(request.amountRequested)}</DetailRow>
              <DetailRow label="ยอดที่อนุมัติ">
                {request.amountApproved !== null ? (
                  <span className="font-semibold text-emerald-700">
                    {formatMoney(request.amountApproved)}
                  </span>
                ) : (
                  'รอการอนุมัติ'
                )}
              </DetailRow>
            </dl>
          </Card>

          <Card title="ผู้ขอรับค่าตอบแทน">
            <dl className="divide-y divide-slate-100">
              <DetailRow label="ชื่อ-สกุล">{personName(request.owner)}</DetailRow>
              <DetailRow label="ตำแหน่งวิชาการ">{request.owner.academicPosition || '-'}</DetailRow>
              <DetailRow label="คณะ">{request.faculty.nameTh}</DetailRow>
              <DetailRow label="สาขาวิชา">{request.departmentName ?? request.owner.department?.nameTh ?? '-'}</DetailRow>
              <DetailRow label="ติดต่อ">
                {[request.owner.email, request.owner.phoneMobile].filter(Boolean).join(' · ')}
              </DetailRow>
            </dl>
            <p className="mt-3 text-xs text-slate-400">
              คณะและสาขาที่แสดงเป็นข้อมูล ณ วันที่ยื่นคำขอ
            </p>
          </Card>

          <Card title="คำรับรองของผู้ขอ">
            <ul className="space-y-2 text-sm">
              {[
                { ok: request.certNotOnStudyLeave, text: 'บทความไม่ได้เกิดขึ้นขณะอยู่ระหว่างการศึกษาต่อ' },
                { ok: request.certNotThesisPart, text: 'บทความไม่เป็นส่วนหนึ่งของวิทยานิพนธ์' },
                { ok: request.certNotDuplicate, text: 'ยังไม่เคยได้รับค่าตอบแทนหรือรางวัลสนับสนุนการตีพิมพ์' },
              ].map((item) => (
                <li key={item.text} className="flex items-start gap-2">
                  <span className={item.ok ? 'text-emerald-600' : 'text-slate-300'}>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4">
                      <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
                    </svg>
                  </span>
                  <span className={item.ok ? 'text-slate-800' : 'text-slate-400'}>{item.text}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="เอกสารแนบ">
            <AttachmentPanel request={request} canEdit={canEditDraft} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="ความคืบหน้า" description="บันทึกทุกการเปลี่ยนสถานะ ใช้แทนลายเซ็นบนกระดาษ">
            {!timeline || timeline.length === 0 ? (
              <p className="text-sm text-slate-500">ยังไม่มีประวัติ</p>
            ) : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-4">
                {timeline.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                    <p className="text-sm font-medium text-slate-800">
                      {STATUS_LABELS[entry.toStatus]}
                    </p>
                    <p className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</p>
                    {entry.actor && (
                      <p className="text-xs text-slate-500">โดย {personName(entry.actor)}</p>
                    )}
                    {entry.note && <p className="mt-1 text-xs text-slate-600">{entry.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="ผลการพิจารณาแต่ละขั้น">
            {request.approvals.length === 0 ? (
              <p className="text-sm text-slate-500">ยังไม่เข้าสู่กระบวนการพิจารณา</p>
            ) : (
              <ul className="space-y-3">
                {request.approvals.map((approval) => (
                  <li key={approval.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {STEP_LABELS[approval.stepCode] ?? approval.stepCode}
                      </p>
                      <Badge
                        className={
                          approval.decision === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : approval.decision === 'RETURNED'
                              ? 'bg-amber-50 text-amber-800 ring-amber-200'
                              : approval.decision === 'REJECTED'
                                ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                : 'bg-slate-100 text-slate-600 ring-slate-200'
                        }
                      >
                        {approval.decision === 'APPROVED'
                          ? 'เห็นชอบ'
                          : approval.decision === 'RETURNED'
                            ? 'ตีกลับ'
                            : approval.decision === 'REJECTED'
                              ? 'ไม่อนุมัติ'
                              : 'รอพิจารณา'}
                      </Badge>
                    </div>
                    {(approval.approverName || approval.approver) && (
                      <p className="mt-1 text-xs text-slate-600">
                        {signerName(approval)}
                        {approval.approverPosition ? ` (${approval.approverPosition})` : ''} ·{' '}
                        {formatDateTime(approval.signedAt)}
                      </p>
                    )}
                    {approval.comment && (
                      <p className="mt-1 text-xs text-slate-600">{approval.comment}</p>
                    )}
                    {approval.missingDocuments && (
                      <p className="mt-1 text-xs text-amber-700">
                        ต้องแก้ไข: {approval.missingDocuments}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(canSetQaYear || request.qaIndicatorYear !== null) && (
            <Card title="ปีตัวชี้วัดประกันคุณภาพ" className="no-print">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-700">
                  {request.qaIndicatorYear !== null ? (
                    <>
                      นับในรอบรายงาน QA ปี{' '}
                      <span className="font-semibold">{request.qaIndicatorYear}</span>
                    </>
                  ) : (
                    <span className="text-slate-500">ยังไม่ได้บันทึก</span>
                  )}
                </p>
                {canSetQaYear && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQaYear(defaultQaYear);
                      setDialog('qa-year');
                    }}
                  >
                    {request.qaIndicatorYear !== null ? 'แก้ไข' : 'บันทึก'}
                  </Button>
                )}
              </div>
            </Card>
          )}

          {request.payment && (
            <Card title="การเบิกจ่าย">
              <dl className="divide-y divide-slate-100">
                <DetailRow label="เลขที่ฎีกา">{request.payment.voucherNo || '-'}</DetailRow>
                <DetailRow label="จำนวนเงิน">{formatMoney(request.payment.amount)}</DetailRow>
                <DetailRow label="วันที่จ่าย">{formatDate(request.payment.paidAt)}</DetailRow>
                {request.payment.isRefunded && (
                  <>
                    <DetailRow label="เรียกเงินคืน">
                      {formatMoney(request.payment.refundAmount)}
                    </DetailRow>
                    <DetailRow label="เหตุผล">{request.payment.refundReason}</DetailRow>
                  </>
                )}
              </dl>
            </Card>
          )}

          {canCancel && (
            <Card className="no-print">
              <Button
                variant="outline"
                className="w-full text-rose-600"
                onClick={() => setDialog('cancel')}
              >
                ยกเลิกคำขอนี้
              </Button>
              <p className="mt-2 text-xs text-slate-500">
                ยกเลิกได้ก่อนเรื่องเข้าสู่ขั้นอนุมัติเท่านั้น
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* --- Dialogs ------------------------------------------------ */}

      <Modal
        open={dialog === 'submit'}
        onClose={closeDialog}
        title={request.status === 'RETURNED' ? 'ส่งคำขอกลับเข้าพิจารณา' : 'ส่งคำขอเข้าสู่กระบวนการ'}
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ยกเลิก
            </Button>
            <Button
              loading={action.isPending}
              disabled={!isFirstAuthor}
              onClick={() =>
                run(
                  `/requests/${request.id}/${request.status === 'RETURNED' ? 'resubmit' : 'submit'}`,
                  { isFirstAuthor },
                  'ส่งคำขอเรียบร้อยแล้ว',
                )
              }
            >
              ยืนยันการส่ง
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            ระบบจะตรวจกฎตามประกาศ 2131/2566 ก่อนส่ง ได้แก่ สิทธิ์ 3 เรื่องต่อปี การเบิกซ้ำ
            ปีที่ตีพิมพ์ รายชื่อวารสารต้องห้าม เอกสารแนบครบ 3 ประเภท และวงเงินปีงบประมาณ
          </p>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-sm">
            <input
              type="checkbox"
              checked={isFirstAuthor}
              onChange={(event) => setIsFirstAuthor(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            <span>
              ข้าพเจ้าขอรับรองว่าเป็น<strong>ผู้เขียนชื่อแรก (First author)</strong>ของบทความนี้
              ตามเงื่อนไขของประกาศ
            </span>
          </label>

          {actionError && (
            <Alert tone="error" title="ส่งคำขอไม่สำเร็จ">
              {issues.length > 0 ? (
                <ul className="ml-4 list-disc space-y-1">
                  {issues.map((issue) => (
                    <li key={issue.code}>{issue.message}</li>
                  ))}
                </ul>
              ) : (
                actionError
              )}
            </Alert>
          )}
        </div>
      </Modal>

      <Modal
        open={dialog === 'approve'}
        onClose={closeDialog}
        title="เห็นชอบและส่งต่อขั้นถัดไป"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ยกเลิก
            </Button>
            <Button
              variant="success"
              loading={action.isPending}
              onClick={() =>
                run(
                  `/requests/${request.id}/approve`,
                  {
                    comment: comment || undefined,
                    // Only the faculty QA step records the QA round; the other
                    // steps leave it untouched.
                    qaIndicatorYear:
                      request.status === 'FACULTY_REVIEW' && qaYear ? Number(qaYear) : undefined,
                  },
                  'บันทึกผลการพิจารณาแล้ว',
                )
              }
            >
              ยืนยันเห็นชอบ
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error">{actionError}</Alert>}
        {request.status === 'FACULTY_REVIEW' && (
          <Field
            label="ปีตัวชี้วัดประกันคุณภาพ (พ.ศ.)"
            hint="ปีรอบรายงาน QA ที่นับบทความนี้ ปกติคือปีที่ตีพิมพ์ แก้ไขภายหลังได้"
            className="mt-3"
          >
            <Input
              type="number"
              min={2400}
              max={2700}
              value={qaYear}
              onChange={(event) => setQaYear(event.target.value)}
            />
          </Field>
        )}
        <Field label="ความเห็น (ถ้ามี)" className="mt-3">
          <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={dialog === 'return'}
        onClose={closeDialog}
        title="ตีกลับให้ผู้ขอแก้ไข"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ยกเลิก
            </Button>
            <Button
              loading={action.isPending}
              disabled={missingDocuments.trim().length < 5}
              onClick={() =>
                run(
                  `/requests/${request.id}/return`,
                  { missingDocuments, comment: comment || undefined },
                  'ตีกลับคำขอแล้ว',
                )
              }
            >
              ยืนยันการตีกลับ
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error">{actionError}</Alert>}
        <div className="space-y-3">
          <Alert tone="info">
            เมื่อผู้ขอแก้ไขและส่งกลับ เรื่องจะกลับมาที่ขั้นตอนนี้โดยตรง ไม่ต้องเริ่มใหม่ทั้งกระบวนการ
          </Alert>
          <Field label="เอกสารหรือข้อมูลที่ต้องแก้ไข" required>
            <Textarea
              value={missingDocuments}
              onChange={(event) => setMissingDocuments(event.target.value)}
              placeholder="ระบุให้ชัดเจนว่าผู้ขอต้องแก้ไขหรือแนบอะไรเพิ่ม"
            />
          </Field>
          <Field label="ความเห็นเพิ่มเติม">
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={dialog === 'reject'}
        onClose={closeDialog}
        title="ไม่อนุมัติคำขอ"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              loading={action.isPending}
              disabled={comment.trim().length < 5}
              onClick={() => run(`/requests/${request.id}/reject`, { comment }, 'บันทึกผลไม่อนุมัติแล้ว')}
            >
              ยืนยันไม่อนุมัติ
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error">{actionError}</Alert>}
        <Alert tone="warning">
          การไม่อนุมัติจะปิดเรื่องนี้ แต่จะไม่ตัดสิทธิ์ 1 ใน 3 เรื่องของผู้ขอ
        </Alert>
        <Field label="เหตุผลที่ไม่อนุมัติ" required className="mt-3">
          <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={dialog === 'final'}
        onClose={closeDialog}
        title="อนุมัติและระบุจำนวนเงิน"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ยกเลิก
            </Button>
            <Button
              variant="success"
              loading={action.isPending}
              onClick={() =>
                run(
                  `/requests/${request.id}/final-approve`,
                  { amountApproved: Number(amountApproved), comment: comment || undefined },
                  'อนุมัติคำขอเรียบร้อยแล้ว',
                )
              }
            >
              ยืนยันการอนุมัติ
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error">{actionError}</Alert>}
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            ยอดที่ขอตามอัตราในประกาศ {formatMoney(request.amountRequested)} อนุมัติน้อยกว่าได้
            เนื่องจากประกาศใช้คำว่า &ldquo;ไม่เกิน&rdquo;
          </p>
          <Field label="จำนวนเงินที่อนุมัติ (บาท)" required>
            <Input
              type="number"
              min={0}
              max={Number(request.amountRequested)}
              step={100}
              value={amountApproved}
              onChange={(event) => setAmountApproved(event.target.value)}
            />
          </Field>
          <Field label="ความเห็น">
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
          <Alert tone="info">
            ระบบจะตรวจวงเงินคงเหลือของปีงบประมาณอีกครั้งขณะบันทึก หากไม่พอจะยกเลิกทั้งรายการ
          </Alert>
        </div>
      </Modal>

      <Modal
        open={dialog === 'committee'}
        onClose={closeDialog}
        title="ส่งเข้าคณะกรรมการบริหารจัดการงานวิจัย"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ยกเลิก
            </Button>
            <Button
              loading={action.isPending}
              disabled={comment.trim().length < 5}
              onClick={() =>
                run(`/requests/${request.id}/to-committee`, { comment }, 'ส่งเข้าคณะกรรมการแล้ว')
              }
            >
              ยืนยัน
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error">{actionError}</Alert>}
        <Field label="เหตุผลที่ต้องให้คณะกรรมการพิจารณา" required>
          <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={dialog === 'pay'}
        onClose={closeDialog}
        title="บันทึกผลการเบิกจ่าย"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ยกเลิก
            </Button>
            <Button
              loading={action.isPending}
              disabled={!voucherNo.trim()}
              onClick={() =>
                run(
                  `/requests/${request.id}/pay`,
                  { voucherNo, paidAt, note: comment || undefined },
                  'บันทึกการจ่ายเรียบร้อยแล้ว',
                )
              }
            >
              บันทึกการจ่าย
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error">{actionError}</Alert>}
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            จำนวนเงินที่อนุมัติ {formatMoney(request.amountApproved)}
          </p>
          <Field label="เลขที่ฎีกา" required>
            <Input value={voucherNo} onChange={(event) => setVoucherNo(event.target.value)} />
          </Field>
          <Field label="วันที่จ่าย" required>
            <Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
          </Field>
          <Field label="หมายเหตุ">
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={dialog === 'cancel'}
        onClose={closeDialog}
        title="ยกเลิกคำขอ"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ไม่ยกเลิก
            </Button>
            <Button
              variant="danger"
              loading={action.isPending}
              onClick={() =>
                action.mutate(
                  { path: `/requests/${request.id}`, method: 'delete' },
                  {
                    onSuccess: async () => {
                      await afterAction('ยกเลิกคำขอแล้ว');
                      navigate('/requests');
                    },
                  },
                )
              }
            >
              ยืนยันยกเลิก
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error">{actionError}</Alert>}
        <p className="text-sm text-slate-600">
          ต้องการยกเลิกคำขอ {request.requestNo} ใช่หรือไม่ การยกเลิกไม่สามารถย้อนกลับได้
          แต่คุณสามารถยื่นคำขอใหม่สำหรับบทความนี้ได้
        </p>
      </Modal>

      <Modal
        open={dialog === 'qa-year'}
        onClose={closeDialog}
        title="บันทึกปีตัวชี้วัดประกันคุณภาพ"
        footer={
          <>
            <Button variant="outline" onClick={closeDialog}>
              ยกเลิก
            </Button>
            <Button
              loading={action.isPending}
              disabled={!/^\d{4}$/.test(qaYear)}
              onClick={() =>
                action.mutate(
                  {
                    path: `/requests/${request.id}/qa-year`,
                    method: 'patch',
                    body: { qaIndicatorYear: Number(qaYear) },
                  },
                  { onSuccess: () => void afterAction('บันทึกปีตัวชี้วัดแล้ว') },
                )
              }
            >
              บันทึก
            </Button>
          </>
        }
      >
        {actionError && <Alert tone="error">{actionError}</Alert>}
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            ปีรอบรายงานประกันคุณภาพที่นับบทความนี้ ใช้ในรายงานตัวชี้วัด QA ของคณะ
            บทความที่ตีพิมพ์ปลายปีบางครั้งนับในรอบถัดไป
          </p>
          <Field label="ปี พ.ศ." required>
            <Input
              type="number"
              min={2400}
              max={2700}
              value={qaYear}
              onChange={(event) => setQaYear(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
