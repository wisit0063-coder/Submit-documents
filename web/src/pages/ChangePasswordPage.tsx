import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Field, Input, useToast } from '@/components/ui';

export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const forced = Boolean(user?.mustChangePassword);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      await refresh();
      toast.push('success', 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
      navigate('/');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">เปลี่ยนรหัสผ่าน</h1>
          {forced && (
            <p className="mt-1 text-sm text-slate-500">
              การเข้าใช้งานครั้งแรกต้องเปลี่ยนรหัสผ่านก่อนจึงจะใช้ระบบได้
            </p>
          )}
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <Field label="รหัสผ่านปัจจุบัน" required>
          <Input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
        </Field>

        <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวอักษรและตัวเลข" required>
          <Input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Field label="ยืนยันรหัสผ่านใหม่" required>
          <Input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Button type="submit" className="w-full" loading={loading}>
          บันทึกรหัสผ่านใหม่
        </Button>

        <button
          type="button"
          onClick={() => void logout().then(() => navigate('/login'))}
          className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
        >
          ออกจากระบบ
        </button>
      </form>
    </div>
  );
}
