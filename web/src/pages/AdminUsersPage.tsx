import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, personName, ROLE_LABELS } from '@/lib/format';
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
  Select,
  Spinner,
  Table,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import type { Department, Faculty, Paged, RoleCode, StaffTrack, UserRow } from '@/types';
import { STAFF_TRACK_LABELS } from '@/lib/registration-schema';

interface RoleOption {
  id: string;
  code: RoleCode;
  nameTh: string;
}

/** Roles whose authority is limited to one faculty must carry a faculty scope. */
const FACULTY_SCOPED_ROLES: RoleCode[] = ['FACULTY_QA', 'DEAN'];

/** POST /users answers with the new account plus its one-time password. */
type CreatedUser = UserRow & { tempPassword: string };

interface UserForm {
  username: string;
  email: string;
  prefix: string;
  firstName: string;
  lastName: string;
  academicPosition: string;
  facultyId: string;
  departmentId: string;
  staffTrack: StaffTrack | '';
  phoneInternal: string;
  phoneMobile: string;
  roles: { roleCode: RoleCode; facultyId: string | null }[];
}

const EMPTY_USER: UserForm = {
  username: '',
  email: '',
  prefix: '',
  firstName: '',
  lastName: '',
  academicPosition: '',
  facultyId: '',
  departmentId: '',
  staffTrack: '',
  phoneInternal: '',
  phoneMobile: '',
  roles: [{ roleCode: 'RESEARCHER', facultyId: null }],
};

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<UserForm>(EMPTY_USER);
  const [error, setError] = useState<string | null>(null);
  // Shown once, right after the account is created. The server never hands the
  // password back a second time, so this dialog is the admin's only copy when
  // the notification email does not arrive.
  const [newAccount, setNewAccount] = useState<{ username: string; tempPassword: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['users', { query, page }],
    queryFn: () => api.get<Paged<UserRow>>('/users', { q: query, page, pageSize: 20 }),
  });

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleOption[]>('/roles'),
    staleTime: 30 * 60_000,
  });

  const { data: faculties } = useQuery({
    queryKey: ['faculties'],
    queryFn: () => api.get<Faculty[]>('/faculties'),
    staleTime: 30 * 60_000,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments', form.facultyId],
    queryFn: () => api.get<Department[]>(`/faculties/${form.facultyId}/departments`),
    enabled: Boolean(form.facultyId),
  });

  useEffect(() => {
    if (!editing) return;
    setForm({
      username: editing.username,
      email: editing.email,
      prefix: editing.prefix ?? '',
      firstName: editing.firstName,
      lastName: editing.lastName,
      academicPosition: editing.academicPosition ?? '',
      // The unit is stored on the user; older accounts only have it via their department.
      facultyId: editing.faculty?.id ?? editing.department?.faculty.id ?? '',
      departmentId: editing.department?.id ?? '',
      staffTrack: editing.staffTrack ?? '',
      // Load the stored numbers: leaving these blank used to wipe them on save.
      phoneInternal: editing.phoneInternal ?? '',
      phoneMobile: editing.phoneMobile ?? '',
      roles: editing.userRoles.map((link) => ({
        roleCode: link.role.code,
        facultyId: link.facultyId,
      })),
    });
  }, [editing]);

  const close = () => {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_USER);
    setError(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        username: form.username,
        email: form.email,
        prefix: form.prefix || null,
        firstName: form.firstName,
        lastName: form.lastName,
        academicPosition: form.academicPosition || null,
        facultyId: form.facultyId || null,
        departmentId: form.departmentId || null,
        staffTrack: form.staffTrack || null,
        phoneInternal: form.phoneInternal || null,
        phoneMobile: form.phoneMobile || null,
        roles: form.roles,
      };
      if (editing) return api.put<UserRow>(`/users/${editing.id}`, payload);
      return api.post<CreatedUser>('/users', payload);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      if (editing) {
        toast.push('success', 'บันทึกข้อมูลผู้ใช้แล้ว');
        close();
        return;
      }
      // Keep the credentials on screen until the admin dismisses them.
      const created = saved as CreatedUser;
      setCopied(false);
      setNewAccount({ username: created.username, tempPassword: created.tempPassword });
      close();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'บันทึกไม่สำเร็จ'),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/users/${id}/status`, { isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.push('success', 'ปรับสถานะบัญชีแล้ว');
    },
    // Without this the last-admin guard would fail silently and the row would
    // simply not change.
    onError: (caught) =>
      toast.push('error', caught instanceof ApiError ? caught.message : 'ปรับสถานะไม่สำเร็จ'),
  });

  const toggleRole = (roleCode: RoleCode, checked: boolean) => {
    setForm((current) => ({
      ...current,
      roles: checked
        ? [...current.roles, { roleCode, facultyId: null }]
        : current.roles.filter((role) => role.roleCode !== roleCode),
    }));
  };

  const setRoleFaculty = (roleCode: RoleCode, facultyId: string) => {
    setForm((current) => ({
      ...current,
      roles: current.roles.map((role) =>
        role.roleCode === roleCode ? { ...role, facultyId: facultyId || null } : role,
      ),
    }));
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="ผู้ใช้งานระบบ"
        description="หนึ่งคนถือได้หลายบทบาท เช่น คณบดีที่ยื่นขอเบิกของตัวเองด้วย"
        action={
          <Button
            onClick={() => {
              setForm(EMPTY_USER);
              setCreating(true);
            }}
          >
            เพิ่มผู้ใช้
          </Button>
        }
      />

      <Card className="mb-4" bodyClassName="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
            setPage(1);
          }}
          className="flex max-w-md gap-2"
        >
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาชื่อ ชื่อผู้ใช้ หรืออีเมล"
          />
          <Button type="submit" variant="outline">
            ค้นหา
          </Button>
        </form>
      </Card>

      <Card bodyClassName="p-5 pt-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : isError ? (
          <ErrorState error={loadError} onRetry={() => void refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="ไม่พบผู้ใช้ตามเงื่อนไข" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>ชื่อ-สกุล</Th>
                  <Th>ชื่อผู้ใช้ / อีเมล</Th>
                  <Th>สังกัด</Th>
                  <Th>บทบาท</Th>
                  <Th>เข้าใช้ล่าสุด</Th>
                  <Th className="text-right">สถานะ</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <Td>
                      <button
                        type="button"
                        onClick={() => setEditing(user)}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {personName(user)}
                      </button>
                      {user.academicPosition && (
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {user.academicPosition}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-slate-700">{user.username}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{user.email}</span>
                    </Td>
                    <Td className="text-sm text-slate-600">
                      {user.faculty || user.department ? (
                        <>
                          {user.faculty?.nameTh ?? user.department?.faculty.nameTh}
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {[
                              // Registered users have a typed name until an
                              // admin links a real department row.
                              user.department?.nameTh ?? user.departmentName,
                              user.staffTrack ? STAFF_TRACK_LABELS[user.staffTrack] : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'ไม่ระบุสาขา'}
                          </span>
                        </>
                      ) : (
                        '-'
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {user.userRoles.map((link) => (
                          <Badge key={link.id}>{ROLE_LABELS[link.role.code]}</Badge>
                        ))}
                      </div>
                    </Td>
                    <Td className="text-xs text-slate-500">{formatDateTime(user.lastLoginAt)}</Td>
                    <Td className="text-right">
                      {user.registrationStatus === 'PENDING' ? (
                        // Applications are decided on their own page, where the
                        // roles are granted; a plain toggle would skip that.
                        <Link to="/admin/registrations">
                          <Badge className="bg-amber-50 text-amber-800 ring-amber-200">
                            รออนุมัติใบสมัคร
                          </Badge>
                        </Link>
                      ) : user.registrationStatus === 'REJECTED' ? (
                        <Badge className="bg-rose-50 text-rose-700 ring-rose-200">ใบสมัครไม่อนุมัติ</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant={user.isActive ? 'ghost' : 'outline'}
                          onClick={() =>
                            toggleStatus.mutate({ id: user.id, isActive: !user.isActive })
                          }
                        >
                          {user.isActive ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>
                ทั้งหมด {data.total} คน · หน้า {data.page} / {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
                  ก่อนหน้า
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((v) => v + 1)}
                >
                  ถัดไป
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Modal
        open={creating || Boolean(editing)}
        onClose={close}
        title={editing ? `แก้ไขผู้ใช้ ${editing.username}` : 'เพิ่มผู้ใช้ใหม่'}
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
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {!editing && (
            <Alert tone="info">
              ระบบจะสร้างรหัสผ่านชั่วคราวและส่งทางอีเมล ผู้ใช้ต้องเปลี่ยนรหัสผ่านในการเข้าใช้ครั้งแรก
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ชื่อผู้ใช้" required>
              <Input
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
              />
            </Field>
            <Field label="อีเมล" required>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field label="คำนำหน้า">
              <Input
                value={form.prefix}
                onChange={(event) => setForm({ ...form, prefix: event.target.value })}
                placeholder="นาย / นาง / ผศ.ดร."
              />
            </Field>
            <Field label="ตำแหน่งทางวิชาการ">
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
            <Field label="หน่วยงาน/สังกัด">
              <Select
                value={form.facultyId}
                onChange={(event) =>
                  setForm({ ...form, facultyId: event.target.value, departmentId: '' })
                }
              >
                <option value="">เลือกหน่วยงาน/สังกัด</option>
                {faculties?.map((faculty) => (
                  <option key={faculty.id} value={faculty.id}>
                    {faculty.nameTh}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="สาขาวิชา">
              <Select
                value={form.departmentId}
                onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
                disabled={!form.facultyId}
              >
                <option value="">เลือกสาขาวิชา</option>
                {departments?.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.nameTh}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="สายงาน/ฝ่าย">
              <Select
                value={form.staffTrack}
                onChange={(event) =>
                  setForm({ ...form, staffTrack: event.target.value as StaffTrack | '' })
                }
              >
                <option value="">ไม่ระบุ</option>
                <option value="ACADEMIC">{STAFF_TRACK_LABELS.ACADEMIC}</option>
                <option value="SUPPORT">{STAFF_TRACK_LABELS.SUPPORT}</option>
              </Select>
            </Field>
            <Field label="โทรศัพท์ภายใน">
              <Input
                value={form.phoneInternal}
                onChange={(event) => setForm({ ...form, phoneInternal: event.target.value })}
              />
            </Field>
            <Field label="โทรศัพท์มือถือ">
              <Input
                value={form.phoneMobile}
                onChange={(event) => setForm({ ...form, phoneMobile: event.target.value })}
              />
            </Field>
          </div>

          <div>
            <p className="label">บทบาท (เลือกได้มากกว่า 1)</p>
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              {roles?.map((role) => {
                const assigned = form.roles.find((item) => item.roleCode === role.code);
                const needsFaculty = FACULTY_SCOPED_ROLES.includes(role.code);
                return (
                  <div key={role.id} className="flex flex-wrap items-center gap-3">
                    <Checkbox
                      checked={Boolean(assigned)}
                      onChange={(event) => toggleRole(role.code, event.target.checked)}
                      label={ROLE_LABELS[role.code] ?? role.nameTh}
                      className="min-w-[220px]"
                    />
                    {assigned && needsFaculty && (
                      <Select
                        className="max-w-xs"
                        value={assigned.facultyId ?? ''}
                        onChange={(event) => setRoleFaculty(role.code, event.target.value)}
                      >
                        <option value="">ทุกคณะ (ไม่แนะนำ)</option>
                        {faculties?.map((faculty) => (
                          <option key={faculty.id} value={faculty.id}>
                            {faculty.nameTh}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="hint">
              บทบาทประกันคุณภาพคณะและคณบดีต้องระบุคณะ เพื่อให้เห็นเฉพาะคำขอของคณะตนเอง
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(newAccount)}
        onClose={() => setNewAccount(null)}
        title="สร้างบัญชีเรียบร้อยแล้ว"
        footer={<Button onClick={() => setNewAccount(null)}>บันทึกรหัสผ่านแล้ว ปิดหน้าต่าง</Button>}
      >
        <div className="space-y-3">
          <Alert tone="warning" title="รหัสผ่านนี้แสดงเพียงครั้งเดียว">
            ระบบไม่เก็บรหัสผ่านนี้ไว้ที่ใดและเรียกดูซ้ำไม่ได้ กรุณาคัดลอกและส่งให้เจ้าของบัญชีทันที
            หากปิดหน้าต่างไปก่อน ให้ใช้เมนู &ldquo;ลืมรหัสผ่าน&rdquo; หรือสร้างบัญชีใหม่
          </Alert>

          <dl className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-sm text-slate-500">ชื่อผู้ใช้</dt>
              <dd className="font-mono text-sm font-medium text-slate-900">
                {newAccount?.username}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-sm text-slate-500">รหัสผ่านชั่วคราว</dt>
              <dd className="select-all font-mono text-base font-bold tracking-wide text-slate-900">
                {newAccount?.tempPassword}
              </dd>
            </div>
          </dl>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              if (!newAccount) return;
              void navigator.clipboard
                ?.writeText(`ชื่อผู้ใช้: ${newAccount.username}\nรหัสผ่านชั่วคราว: ${newAccount.tempPassword}`)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกชื่อผู้ใช้และรหัสผ่าน'}
          </Button>

          <p className="text-xs text-slate-500">
            ระบบพยายามส่งอีเมลให้เจ้าของบัญชีด้วย แต่จะส่งได้จริงก็ต่อเมื่อตั้งค่า SMTP ไว้แล้วเท่านั้น
            เจ้าของบัญชีจะถูกบังคับให้เปลี่ยนรหัสผ่านทันทีที่เข้าสู่ระบบครั้งแรก
          </p>
        </div>
      </Modal>
    </>
  );
}
