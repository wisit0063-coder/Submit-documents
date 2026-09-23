import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, personName, ROLE_LABELS } from '@/lib/format';
import { STAFF_TRACK_LABELS } from '@/lib/registration-schema';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Select,
  PageHeader,
  Spinner,
  Textarea,
  useToast,
  cn,
} from '@/components/ui';
import type { Faculty, Registration, RegistrationStatus, ReviewerGap, RoleCode } from '@/types';

const TABS: { status: RegistrationStatus; label: string }[] = [
  { status: 'PENDING', label: 'รอตรวจสอบ' },
  { status: 'APPROVED', label: 'อนุมัติแล้ว' },
  { status: 'REJECTED', label: 'ไม่อนุมัติ' },
];

/**
 * Higher positions an admin may grant while approving (CLAUDE.md section 13.4).
 * RESEARCHER is always granted by the server and is not listed.
 */
const EXTRA_ROLES: RoleCode[] = [
  'FACULTY_QA',
  'DEAN',
  'RDI_OFFICER',
  'ACADEMIC_OFFICE',
  'APPROVER',
  'FINANCE',
  'ADMIN',
];
const FACULTY_SCOPED: RoleCode[] = ['FACULTY_QA', 'DEAN'];

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800">{value || '-'}</dd>
    </div>
  );
}

export function AdminRegistrationsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<RegistrationStatus>('PENDING');
  const [approving, setApproving] = useState<Registration | null>(null);
  const [rejecting, setRejecting] = useState<Registration | null>(null);
  const [extraRoles, setExtraRoles] = useState<RoleCode[]>([]);
  const [facultyId, setFacultyId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: faculties } = useQuery({
    queryKey: ['faculties'],
    queryFn: () => api.get<Faculty[]>('/faculties'),
    staleTime: 30 * 60_000,
  });

  const { data: registrations, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['registrations', tab],
    queryFn: () => api.get<Registration[]>('/registrations', { status: tab }),
  });

  const { data: gaps } = useQuery({
    queryKey: ['reviewer-coverage'],
    queryFn: () => api.get<ReviewerGap[]>('/users/reviewer-coverage'),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['registrations'] });
    await queryClient.invalidateQueries({ queryKey: ['registrations-count'] });
    await queryClient.invalidateQueries({ queryKey: ['reviewer-coverage'] });
    await queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const close = () => {
    setApproving(null);
    setRejecting(null);
    setExtraRoles([]);
    setFacultyId('');
    setReason('');
    setError(null);
  };

  const openApprove = (registration: Registration) => {
    setError(null);
    setExtraRoles([]);
    // Pre-fill only if a unit was somehow already set on the account.
    setFacultyId(registration.faculty?.id ?? '');
    setApproving(registration);
  };

  const approve = useMutation({
    mutationFn: (registration: Registration) =>
      api.post(`/registrations/${registration.id}/approve`, {
        // The unit is decided here; the sign-up form does not ask for one.
        facultyId,
        // Scoped roles are sent without a faculty: the server scopes them to the
        // unit chosen above, which is what the dialog promises.
        roles: extraRoles.map((roleCode) => ({ roleCode })),
      }),
    onSuccess: async () => {
      await refresh();
      toast.push('success', 'อนุมัติใบสมัครแล้ว ระบบแจ้งผู้สมัครทางอีเมล');
      close();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'อนุมัติไม่สำเร็จ'),
  });

  const reject = useMutation({
    mutationFn: (registration: Registration) =>
      api.post(`/registrations/${registration.id}/reject`, { reason }),
    onSuccess: async () => {
      await refresh();
      toast.push('success', 'บันทึกผลไม่อนุมัติแล้ว ระบบแจ้งผู้สมัครพร้อมเหตุผล');
      close();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'บันทึกผลไม่สำเร็จ'),
  });

  const toggleRole = (role: RoleCode, checked: boolean) =>
    setExtraRoles((current) =>
      checked ? [...current, role] : current.filter((item) => item !== role),
    );

  return (
    <>
      <PageHeader
        title="ใบสมัครสมาชิก"
        description="ตรวจสอบว่าผู้สมัครเป็นบุคลากรของมหาวิทยาลัยก่อนอนุมัติ (ประกาศ 2131/2566 ข้อ 1)"
      />

      {gaps && gaps.length > 0 && (
        <div className="mb-5">
          <Alert tone="warning" title="มีหน่วยงานที่ยังไม่มีผู้ตรวจระดับคณะ">
            <p>คำขอจากหน่วยงานเหล่านี้จะค้างอยู่ที่ขั้นแรกจนกว่าจะมอบหมายบทบาทให้ครบ</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {gaps.map((gap) => (
                <li key={gap.facultyId}>
                  {gap.facultyName}: ขาด{' '}
                  {[
                    gap.missingFacultyQa && ROLE_LABELS.FACULTY_QA,
                    gap.missingDean && ROLE_LABELS.DEAN,
                  ]
                    .filter(Boolean)
                    .join(' และ ')}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.status}
            type="button"
            onClick={() => setTab(item.status)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition',
              tab === item.status
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : isError ? (
        <ErrorState error={loadError} onRetry={() => void refetch()} />
      ) : !registrations || registrations.length === 0 ? (
        <EmptyState
          title={
            tab === 'PENDING' ? 'ไม่มีใบสมัครที่รอตรวจสอบ' : `ไม่มีใบสมัครสถานะ${TABS.find((t) => t.status === tab)?.label}`
          }
        />
      ) : (
        <div className="space-y-3">
          {registrations.map((registration) => (
            <Card key={registration.id} bodyClassName="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-900">
                    {registration.firstName} {registration.lastName}
                  </p>
                  <p className="text-sm text-slate-500">{registration.email}</p>
                </div>
                <Badge
                  className={
                    registration.registrationStatus === 'PENDING'
                      ? 'bg-amber-50 text-amber-800 ring-amber-200'
                      : registration.registrationStatus === 'APPROVED'
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : 'bg-rose-50 text-rose-700 ring-rose-200'
                  }
                >
                  {TABS.find((t) => t.status === registration.registrationStatus)?.label}
                </Badge>
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="หน่วยงาน/สังกัด" value={registration.faculty?.nameTh ?? 'ไม่ระบุ'} />
                <Detail
                  label="สายงาน/ฝ่าย"
                  value={registration.staffTrack ? STAFF_TRACK_LABELS[registration.staffTrack] : null}
                />
                <Detail
                  label="สาขาวิชา (ผู้สมัครกรอกเอง)"
                  value={registration.departmentName ?? registration.department?.nameTh ?? 'ไม่ระบุ'}
                />
                <Detail label="เบอร์โทรศัพท์" value={registration.phoneMobile} />
                <Detail label="สมัครเมื่อ" value={formatDateTime(registration.updatedAt)} />
                {registration.registrationReviewer && (
                  <Detail
                    label="พิจารณาโดย"
                    value={`${personName(registration.registrationReviewer)} · ${formatDateTime(registration.registrationReviewedAt)}`}
                  />
                )}
              </dl>

              {registration.registrationNote && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  เหตุผลที่ไม่อนุมัติ: {registration.registrationNote}
                </p>
              )}

              {registration.registrationStatus === 'PENDING' && (
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                  <Button variant="outline" onClick={() => setRejecting(registration)}>
                    ไม่อนุมัติ
                  </Button>
                  <Button variant="success" onClick={() => openApprove(registration)}>
                    อนุมัติ
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(approving)}
        onClose={close}
        title="อนุมัติใบสมัคร"
        footer={
          <>
            <Button variant="outline" onClick={close}>
              ยกเลิก
            </Button>
            <Button
              variant="success"
              loading={approve.isPending}
              disabled={!facultyId}
              onClick={() => approving && approve.mutate(approving)}
            >
              ยืนยันอนุมัติ
            </Button>
          </>
        }
      >
        {approving && (
          <div className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <p className="text-sm text-slate-600">
              {approving.firstName} {approving.lastName} · {approving.email}
            </p>

            <Field
              label="หน่วยงาน/สังกัด"
              required
              hint={
                approving.departmentName
                  ? `แก้ได้หากผู้สมัครเลือกผิด สาขาวิชาที่กรอกไว้: "${approving.departmentName}"`
                  : 'แก้ได้หากผู้สมัครเลือกหน่วยงานผิด'
              }
            >
              <Select value={facultyId} onChange={(event) => setFacultyId(event.target.value)}>
                <option value="">เลือกหน่วยงาน/สังกัด</option>
                {faculties?.map((faculty) => (
                  <option key={faculty.id} value={faculty.id}>
                    {faculty.nameTh}
                  </option>
                ))}
              </Select>
            </Field>

            <Alert tone="info">
              ระบบให้บทบาท <strong>{ROLE_LABELS.RESEARCHER}</strong> ทุกครั้งที่อนุมัติ
              ถ้าผู้สมัครมีตำแหน่งสูงกว่านี้ เลือกเพิ่มได้ด้านล่าง
            </Alert>
            <Field label="ตำแหน่งเพิ่มเติม (ไม่บังคับ)">
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                {EXTRA_ROLES.map((role) => (
                  <Checkbox
                    key={role}
                    checked={extraRoles.includes(role)}
                    onChange={(event) => toggleRole(role, event.target.checked)}
                    label={
                      <>
                        {ROLE_LABELS[role]}
                        {FACULTY_SCOPED.includes(role) && (
                          <span className="ml-1 text-xs text-slate-500">
                            (เฉพาะ {approving.faculty?.nameTh ?? 'หน่วยงานของผู้สมัคร'})
                          </span>
                        )}
                      </>
                    }
                  />
                ))}
              </div>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(rejecting)}
        onClose={close}
        title="ไม่อนุมัติใบสมัคร"
        footer={
          <>
            <Button variant="outline" onClick={close}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              loading={reject.isPending}
              disabled={reason.trim().length < 5}
              onClick={() => rejecting && reject.mutate(rejecting)}
            >
              ยืนยันไม่อนุมัติ
            </Button>
          </>
        }
      >
        {rejecting && (
          <div className="space-y-3">
            {error && <Alert tone="error">{error}</Alert>}
            <p className="text-sm text-slate-600">
              {rejecting.firstName} {rejecting.lastName} · {rejecting.email}
            </p>
            <Field
              label="เหตุผล"
              required
              hint="ระบบส่งเหตุผลนี้ให้ผู้สมัครทางอีเมล ผู้สมัครแก้ข้อมูลแล้วสมัครใหม่ด้วยอีเมลเดิมได้"
            >
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
