import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DOC_TYPE_LABELS, REQUIRED_DOC_TYPES, formatMoney, toDateInput } from '@/lib/format';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  useToast,
} from '@/components/ui';
import { AttachmentPanel } from '@/components/AttachmentPanel';
import type { Department, JournalTier, RequestDetail } from '@/types';

interface FormState {
  articleTitle: string;
  journalName: string;
  volume: string;
  issue: string;
  pages: string;
  issn: string;
  doi: string;
  articleUrl: string;
  publishedAt: string;
  journalTierId: string;
  fromConference: boolean;
  departmentId: string;
  certNotOnStudyLeave: boolean;
  certNotThesisPart: boolean;
  certNotDuplicate: boolean;
}

const EMPTY_FORM: FormState = {
  articleTitle: '',
  journalName: '',
  volume: '',
  issue: '',
  pages: '',
  issn: '',
  doi: '',
  articleUrl: '',
  publishedAt: '',
  journalTierId: '',
  fromConference: false,
  departmentId: '',
  certNotOnStudyLeave: false,
  certNotThesisPart: false,
  certNotDuplicate: false,
};

export function RequestFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const {
    data: tiers,
    isError: tiersFailed,
    refetch: refetchTiers,
  } = useQuery({
    queryKey: ['journal-tiers'],
    queryFn: () => api.get<JournalTier[]>('/journal-tiers'),
    staleTime: 30 * 60_000,
  });

  const {
    data: departments,
    isError: departmentsFailed,
    refetch: refetchDepartments,
  } = useQuery({
    queryKey: ['departments', user?.facultyId],
    queryFn: () => api.get<Department[]>(`/faculties/${user?.facultyId}/departments`),
    enabled: Boolean(user?.facultyId),
    staleTime: 30 * 60_000,
  });

  const {
    data: existing,
    isLoading,
    isError: existingFailed,
    error: existingError,
    refetch: refetchExisting,
  } = useQuery({
    queryKey: ['request', id],
    queryFn: () => api.get<RequestDetail>(`/requests/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      articleTitle: existing.articleTitle,
      journalName: existing.journalName,
      volume: existing.volume ?? '',
      issue: existing.issue ?? '',
      pages: existing.pages ?? '',
      issn: existing.issn ?? '',
      doi: existing.doi ?? '',
      articleUrl: existing.articleUrl ?? '',
      publishedAt: toDateInput(existing.publishedAt),
      journalTierId: existing.journalTier.id,
      fromConference: existing.fromConference,
      departmentId: existing.departmentId,
      certNotOnStudyLeave: existing.certNotOnStudyLeave,
      certNotThesisPart: existing.certNotThesisPart,
      certNotDuplicate: existing.certNotDuplicate,
    });
  }, [existing]);

  useEffect(() => {
    if (!isEdit && user?.departmentId) {
      setForm((current) => ({ ...current, departmentId: user.departmentId as string }));
    }
  }, [isEdit, user?.departmentId]);

  /**
   * The amount is never typed in: it is read from journal_tiers so the form can
   * never disagree with the announced rate.
   */
  const selectedTier = useMemo(
    () => tiers?.find((tier) => tier.id === form.journalTierId) ?? null,
    [tiers, form.journalTierId],
  );
  const amount = selectedTier
    ? form.fromConference
      ? selectedTier.rateConference
      : selectedTier.rateNormal
    : null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: async (): Promise<RequestDetail> => {
      const payload = {
        ...form,
        volume: form.volume || null,
        issue: form.issue || null,
        pages: form.pages || null,
        issn: form.issn || null,
        doi: form.doi || null,
        articleUrl: form.articleUrl || null,
      };
      if (isEdit) return api.put<RequestDetail>(`/requests/${id}`, payload);
      return api.post<RequestDetail>('/requests', payload);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      await queryClient.invalidateQueries({ queryKey: ['request', String(saved.id)] });
      toast.push('success', isEdit ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกคำขอฉบับร่างแล้ว');
      navigate(`/requests/${saved.id}`);
    },
    onError: (caught) => {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors);
        setError(caught.message);
      } else {
        setError('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    save.mutate();
  };

  // Without this an edit page whose request failed to load showed the empty
  // new-request form - and saving it would have sent blanks over the draft.
  if (isEdit && existingFailed) {
    return (
      <div className="py-10">
        <ErrorState error={existingError} onRetry={() => void refetchExisting()} />
        <div className="mt-4 text-center">
          <Link to="/requests" className="text-sm text-brand-700 hover:underline">
            กลับไปหน้ารายการคำขอ
          </Link>
        </div>
      </div>
    );
  }

  if (isEdit && isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-7 w-7 text-brand-600" />
      </div>
    );
  }

  const locked = isEdit && existing && !['DRAFT', 'RETURNED'].includes(existing.status);

  return (
    <>
      <PageHeader
        title={isEdit ? `แก้ไขคำขอ ${existing?.requestNo ?? ''}` : 'ยื่นคำขอรับค่าตอบแทนการตีพิมพ์'}
        description="กรอกข้อมูลตามแบบฟอร์ม CPRU-RDI-F011 ระบบจะบันทึกเป็นฉบับร่างก่อน แล้วจึงกดส่งในหน้ารายละเอียด"
        action={
          <Link to={isEdit ? `/requests/${id}` : '/requests'}>
            <Button variant="outline">ยกเลิก</Button>
          </Link>
        }
      />

      {locked && (
        <Alert tone="warning" title="คำขอนี้แก้ไขไม่ได้แล้ว">
          แก้ไขได้เฉพาะคำขอสถานะร่างหรือที่ถูกตีกลับเท่านั้น
        </Alert>
      )}

      {error && (
        <div className="mb-4">
          <Alert tone="error" title="บันทึกไม่สำเร็จ">
            {error}
          </Alert>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card title="1. ข้อมูลบทความ">
          <div className="grid gap-4">
            <Field label="ชื่อบทความ" required error={fieldErrors.articleTitle}>
              <Input
                value={form.articleTitle}
                onChange={(event) => set('articleTitle', event.target.value)}
                invalid={Boolean(fieldErrors.articleTitle)}
                placeholder="ชื่อบทความตามที่ปรากฏในวารสาร"
                required
                disabled={locked}
              />
            </Field>

            <Field label="ชื่อวารสาร" required error={fieldErrors.journalName}>
              <Input
                value={form.journalName}
                onChange={(event) => set('journalName', event.target.value)}
                invalid={Boolean(fieldErrors.journalName)}
                required
                disabled={locked}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="ปีที่ (Volume)" error={fieldErrors.volume}>
                <Input value={form.volume} onChange={(e) => set('volume', e.target.value)} disabled={locked} />
              </Field>
              <Field label="ฉบับที่ (Issue)" error={fieldErrors.issue}>
                <Input value={form.issue} onChange={(e) => set('issue', e.target.value)} disabled={locked} />
              </Field>
              <Field label="เลขหน้า/รหัส" error={fieldErrors.pages}>
                <Input
                  value={form.pages}
                  onChange={(e) => set('pages', e.target.value)}
                  placeholder="เช่น 125-138"
                  disabled={locked}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ISSN" hint="รูปแบบ xxxx-xxxx" error={fieldErrors.issn}>
                <Input
                  value={form.issn}
                  onChange={(e) => set('issn', e.target.value)}
                  invalid={Boolean(fieldErrors.issn)}
                  placeholder="1234-5678"
                  disabled={locked}
                />
              </Field>
              <Field
                label="DOI"
                hint="ใช้ตรวจสอบการเบิกซ้ำ หากไม่มี DOI ระบบจะใช้ ISSN คู่กับชื่อบทความแทน"
                error={fieldErrors.doi}
              >
                <Input
                  value={form.doi}
                  onChange={(e) => set('doi', e.target.value)}
                  placeholder="10.1000/xyz123"
                  disabled={locked}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ลิงก์บทความ" error={fieldErrors.articleUrl}>
                <Input
                  type="url"
                  value={form.articleUrl}
                  onChange={(e) => set('articleUrl', e.target.value)}
                  invalid={Boolean(fieldErrors.articleUrl)}
                  placeholder="https://"
                  disabled={locked}
                />
              </Field>
              <Field
                label="วันที่ตีพิมพ์"
                hint="ต้องอยู่ในปีปฏิทินเดียวกับปีที่ยื่นขอ"
                required
                error={fieldErrors.publishedAt}
              >
                <Input
                  type="date"
                  value={form.publishedAt}
                  onChange={(e) => set('publishedAt', e.target.value)}
                  invalid={Boolean(fieldErrors.publishedAt)}
                  required
                  disabled={locked}
                />
              </Field>
            </div>

            {departmentsFailed && (
              // The department is required to file, and this field used to just
              // vanish when its list failed - leaving no way to supply it.
              <Alert tone="error" title="โหลดรายการสาขาวิชาไม่สำเร็จ">
                ต้องเลือกสาขาวิชาจึงจะบันทึกคำขอได้{' '}
                <button
                  type="button"
                  className="font-medium underline"
                  onClick={() => void refetchDepartments()}
                >
                  โหลดรายการใหม่
                </button>
              </Alert>
            )}

            {departments && departments.length > 0 && (
              <Field
                label="สาขาวิชาต้นสังกัด"
                hint="ระบบจะบันทึกหน่วยงานและสาขาไว้เป็นข้อมูล ณ วันที่ยื่น"
                // Sign-up leaves the department optional, but a request cannot
                // be filed without one (requests.department_id is NOT NULL).
                required
                error={fieldErrors.departmentId}
              >
                <Select
                  value={form.departmentId}
                  onChange={(e) => set('departmentId', e.target.value)}
                  disabled={locked}
                  required
                  invalid={Boolean(fieldErrors.departmentId)}
                >
                  <option value="">เลือกสาขาวิชา</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.nameTh}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </Card>

        <Card
          title="2. ฐานข้อมูลวารสารและจำนวนเงิน"
          description="จำนวนเงินคำนวณจากอัตราในประกาศโดยอัตโนมัติ ไม่สามารถกรอกเองได้"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="ฐานข้อมูลวารสาร"
              required
              error={
                tiersFailed ? 'โหลดรายการฐานข้อมูลวารสารไม่สำเร็จ' : fieldErrors.journalTierId
              }
            >
              <Select
                value={form.journalTierId}
                onChange={(e) => set('journalTierId', e.target.value)}
                invalid={Boolean(fieldErrors.journalTierId)}
                required
                disabled={locked}
              >
                <option value="">เลือกฐานข้อมูล</option>
                {tiers?.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.nameTh}
                  </option>
                ))}
              </Select>
              {tiersFailed && (
                <button
                  type="button"
                  className="mt-1 text-sm font-medium text-brand-700 hover:underline"
                  onClick={() => void refetchTiers()}
                >
                  โหลดรายการใหม่
                </button>
              )}
            </Field>

            <Field label="ประเภทการตีพิมพ์">
              <div className="flex h-10 items-center">
                <Checkbox
                  checked={form.fromConference}
                  onChange={(e) => set('fromConference', e.target.checked)}
                  disabled={locked}
                  label="บทความคัดเลือกจากการประชุมวิชาการ (conference)"
                />
              </div>
            </Field>
          </div>

          <div className="mt-4 rounded-lg bg-brand-50 px-4 py-3 ring-1 ring-inset ring-brand-100">
            <p className="text-sm text-brand-900">จำนวนเงินที่ขอรับตามอัตราในประกาศ</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-brand-800">
              {amount !== null ? formatMoney(amount) : 'เลือกฐานข้อมูลเพื่อคำนวณ'}
            </p>
            {selectedTier?.announcementRef && (
              <p className="mt-1 text-xs text-brand-700">
                อ้างอิงประกาศเลขที่ {selectedTier.announcementRef}
              </p>
            )}
          </div>
        </Card>

        <Card
          title="3. คำรับรองของผู้ขอ"
          description="ต้องยืนยันครบทั้ง 3 ข้อจึงจะส่งคำขอได้ ตามประกาศ 2131/2566"
        >
          <div className="space-y-3">
            <Checkbox
              checked={form.certNotOnStudyLeave}
              onChange={(e) => set('certNotOnStudyLeave', e.target.checked)}
              disabled={locked}
              label="ข้าพเจ้าไม่อยู่ระหว่างลาศึกษาต่อเต็มเวลา"
            />
            <Checkbox
              checked={form.certNotThesisPart}
              onChange={(e) => set('certNotThesisPart', e.target.checked)}
              disabled={locked}
              label="บทความนี้ไม่เป็นส่วนหนึ่งของวิทยานิพนธ์หรือการศึกษาของข้าพเจ้า"
            />
            <Checkbox
              checked={form.certNotDuplicate}
              onChange={(e) => set('certNotDuplicate', e.target.checked)}
              disabled={locked}
              label="บทความนี้ยังไม่เคยได้รับค่าตอบแทนการตีพิมพ์จากมหาวิทยาลัยมาก่อน"
            />
          </div>
        </Card>

        {isEdit && existing ? (
          <Card
            title="4. เอกสารแนบ"
            description="ต้องแนบครบ 3 ประเภทบังคับก่อนส่งคำขอ รองรับ PDF, JPG, PNG ไม่เกิน 10MB ต่อไฟล์"
          >
            <AttachmentPanel request={existing} canEdit={!locked} />
          </Card>
        ) : (
          <Card title="4. เอกสารแนบ">
            <Alert tone="info">
              บันทึกคำขอฉบับร่างก่อน จากนั้นระบบจะเปิดให้แนบเอกสาร{' '}
              {REQUIRED_DOC_TYPES.map((type) => DOC_TYPE_LABELS[type]).join(' · ')}
            </Alert>
          </Card>
        )}

        <div className="flex justify-end gap-2 pb-6">
          <Link to={isEdit ? `/requests/${id}` : '/requests'}>
            <Button type="button" variant="outline">
              ยกเลิก
            </Button>
          </Link>
          <Button type="submit" loading={save.isPending} disabled={Boolean(locked)}>
            {isEdit ? 'บันทึกการแก้ไข' : 'บันทึกฉบับร่าง'}
          </Button>
        </div>
      </form>
    </>
  );
}
