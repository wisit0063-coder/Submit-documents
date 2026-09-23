import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';

function AuthShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {children}
        <div className="text-center">
          <Link to="/login" className="text-sm text-brand-700 hover:underline">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      // The API answers the same way whether or not the address exists.
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="ลืมรหัสผ่าน" description="ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปยังอีเมลของท่าน">
      {sent ? (
        <Alert tone="success" title="ส่งอีเมลแล้ว">
          หากอีเมลนี้มีอยู่ในระบบ ท่านจะได้รับลิงก์ตั้งรหัสผ่านใหม่ภายในไม่กี่นาที
          ลิงก์มีอายุ 1 ชั่วโมง
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="อีเมล" required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      navigate('/login');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="ลิงก์ไม่ถูกต้อง">
        <Alert tone="error">ลิงก์ตั้งรหัสผ่านไม่สมบูรณ์ กรุณาขอลิงก์ใหม่อีกครั้ง</Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="ตั้งรหัสผ่านใหม่">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวอักษรและตัวเลข" required>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="ยืนยันรหัสผ่านใหม่" required>
          <Input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          บันทึกรหัสผ่านใหม่
        </Button>
      </form>
    </AuthShell>
  );
}
