import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import {
  registerFormSchema,
  STAFF_TRACK_LABELS,
  type RegisterForm,
} from '@/lib/registration-schema';
import { Alert, Button, Field, Input, Select, Spinner, cn } from '@/components/ui';
import type { Faculty, StaffTrack } from '@/types';

const EMPTY_FORM: RegisterForm = {
  facultyId: '',
  staffTrack: '',
  departmentName: '',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  password: '',
  confirmPassword: '',
};

const STAFF_TRACKS: StaffTrack[] = ['ACADEMIC', 'SUPPORT'];

function Section({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2.5 text-base font-semibold text-slate-900">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
          {number}
        </span>
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/**
 * Public sign-up page (CLAUDE.md section 13).
 *
 * There is deliberately no role or position field: a sign-up only ever becomes
 * a RESEARCHER, and an admin assigns anything higher.
 */
export function RegisterPage() {
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const {
    data: faculties,
    isLoading: loadingFaculties,
    isError: facultiesFailed,
    refetch: refetchFaculties,
  } = useQuery({
    queryKey: ['faculties'],
    queryFn: () => api.get<Faculty[]>('/faculties'),
    staleTime: 30 * 60_000,
  });

  // The dropdown has no blank option, so it always shows the first unit. Mirror
  // that in state, otherwise the form would submit an empty unit while the
  // screen shows one selected.
  useEffect(() => {
    const first = faculties?.[0];
    if (first) setForm((current) => (current.facultyId ? current : { ...current, facultyId: first.id }));
  }, [faculties]);

  const set = <K extends keyof RegisterForm>(key: K, value: RegisterForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    // Clear a field's error as soon as the person starts fixing it.
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const register = useMutation({
    mutationFn: (payload: unknown) => api.post('/auth/register', payload),
    onSuccess: () => {
      setSubmitted(true);
      window.scrollTo({ top: 0 });
    },
    onError: (caught) => {
      if (caught instanceof ApiError) {
        setErrors(caught.fieldErrors);
        setSubmitError(
          caught.code === 'EMAIL_ALREADY_REGISTERED'
            ? 'อีเมลนี้ถูกใช้สมัครไว้แล้ว หากเคยสมัครและรอการอนุมัติอยู่ ไม่ต้องสมัครซ้ำ'
            : caught.message,
        );
      } else {
        setSubmitError('ส่งใบสมัครไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const parsed = registerFormSchema.safeParse({
      ...form,
      departmentName: form.departmentName || null,
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message])),
      );
      return;
    }
    setErrors({});
    register.mutate(parsed.data);
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
        <div className="card w-full max-w-md p-6 text-center sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6" aria-hidden="true">
              <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
            </svg>
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">ส่งใบสมัครเรียบร้อยแล้ว</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            รอผู้ดูแลระบบตรวจสอบ ระบบจะแจ้งผลทางอีเมล{' '}
            <span className="font-medium text-slate-800">{form.email.trim().toLowerCase()}</span>
          </p>
          <p className="mt-1 text-sm text-slate-500">
            เมื่อได้รับอนุมัติแล้ว เข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่ตั้งไว้
          </p>
          <Link to="/login" className="mt-6 inline-block">
            <Button variant="outline">กลับไปหน้าเข้าสู่ระบบ</Button>
          </Link>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            CP
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">สมัครสมาชิก</h1>
            <p className="text-sm text-slate-500">
              ระบบเบิกค่าตอบแทนการตีพิมพ์บทความ มหาวิทยาลัยราชภัฏชัยภูมิ
            </p>
          </div>
        </div>

        <div className="mb-5">
          <Alert tone="info">
            สำหรับบุคลากรของมหาวิทยาลัย ผู้ดูแลระบบจะตรวจสอบก่อนเปิดให้ใช้งาน
            บัญชีที่สมัครจะได้สิทธิ์ยื่นขอรับค่าตอบแทน ส่วนตำแหน่งผู้ตรวจหรือผู้อนุมัติ
            ผู้ดูแลระบบจะกำหนดให้เอง
          </Alert>
        </div>

        {submitError && (
          <div className="mb-5">
            <Alert tone="error" title="ส่งใบสมัครไม่สำเร็จ">
              {submitError}
            </Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <Section number={1} title="หน่วยงาน">
            <Field label="หน่วยงาน/สังกัด" required error={errors.facultyId}>
              {loadingFaculties ? (
                <div className="flex h-10 items-center gap-2 text-sm text-slate-500">
                  <Spinner className="h-4 w-4" /> กำลังโหลดรายชื่อหน่วยงาน
                </div>
              ) : facultiesFailed ? (
                // Otherwise the dropdown is empty and submitting only says "choose
                // a unit" - on a phone, with nothing to choose from.
                <div className="flex min-h-10 flex-wrap items-center gap-x-2 text-sm text-rose-700">
                  โหลดรายชื่อหน่วยงานไม่สำเร็จ
                  <button
                    type="button"
                    className="font-medium text-brand-700 underline"
                    onClick={() => void refetchFaculties()}
                  >
                    ลองใหม่
                  </button>
                </div>
              ) : (
                <Select
                  value={form.facultyId}
                  onChange={(event) => set('facultyId', event.target.value)}
                  invalid={Boolean(errors.facultyId)}
                  aria-required="true"
                >
                  {/* No blank option: the list opens on the first unit. */}
                  {faculties?.map((faculty) => (
                    <option key={faculty.id} value={faculty.id}>
                      {faculty.nameTh}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="สายงาน/ฝ่าย"
              required
              error={errors.staffTrack}
            >
              {/* Always selectable: it no longer waits for a unit to be chosen. */}
              <div role="radiogroup" aria-label="สายงาน/ฝ่าย" className="grid gap-2 sm:grid-cols-2">
                {STAFF_TRACKS.map((track) => {
                  const checked = form.staffTrack === track;
                  return (
                    <label
                      key={track}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition',
                        checked
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                        errors.staffTrack && !checked && 'border-rose-300',
                      )}
                    >
                      <input
                        type="radio"
                        name="staffTrack"
                        value={track}
                        checked={checked}
                        onChange={() => set('staffTrack', track)}
                        className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      {STAFF_TRACK_LABELS[track]}
                    </label>
                  );
                })}
              </div>
            </Field>

            <Field
              label="สาขาวิชา"
              hint="ไม่บังคับ พิมพ์ชื่อสาขาวิชาหรือกลุ่มงานของท่าน เว้นว่างได้"
              error={errors.departmentName}
            >
              <Input
                value={form.departmentName}
                onChange={(event) => set('departmentName', event.target.value)}
                invalid={Boolean(errors.departmentName)}
                placeholder="เช่น วิทยาการคอมพิวเตอร์"
                maxLength={255}
              />
            </Field>
          </Section>

          <Section number={2} title="ข้อมูลผู้สมัคร">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ชื่อ" required error={errors.firstName}>
                <Input
                  value={form.firstName}
                  onChange={(event) => set('firstName', event.target.value)}
                  invalid={Boolean(errors.firstName)}
                  autoComplete="given-name"
                />
              </Field>
              <Field label="นามสกุล" required error={errors.lastName}>
                <Input
                  value={form.lastName}
                  onChange={(event) => set('lastName', event.target.value)}
                  invalid={Boolean(errors.lastName)}
                  autoComplete="family-name"
                />
              </Field>
            </div>
            <Field label="เบอร์โทรศัพท์" required error={errors.phone}>
              <Input
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
                invalid={Boolean(errors.phone)}
                placeholder="เช่น 081-234-5678"
                autoComplete="tel"
              />
            </Field>
          </Section>

          <Section number={3} title="บัญชีเข้าใช้งาน">
            <Field
              label="อีเมล"
              required
              hint="ใช้เป็นชื่อผู้ใช้สำหรับเข้าสู่ระบบ และใช้รับผลการพิจารณา"
              error={errors.email}
            >
              <Input
                type="email"
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
                invalid={Boolean(errors.email)}
                autoComplete="email"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="รหัสผ่าน"
                required
                hint="อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข"
                error={errors.password}
              >
                <Input
                  type="password"
                  value={form.password}
                  onChange={(event) => set('password', event.target.value)}
                  invalid={Boolean(errors.password)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="ยืนยันรหัสผ่าน" required error={errors.confirmPassword}>
                <Input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(event) => set('confirmPassword', event.target.value)}
                  invalid={Boolean(errors.confirmPassword)}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          </Section>

          <div className="flex flex-col-reverse items-stretch gap-3 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/login" className="text-center text-sm text-brand-700 hover:underline">
              มีบัญชีอยู่แล้ว? เข้าสู่ระบบ
            </Link>
            <Button type="submit" size="lg" loading={register.isPending}>
              ส่งใบสมัคร
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
