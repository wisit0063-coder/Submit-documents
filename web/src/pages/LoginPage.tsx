import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate('/');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="relative flex flex-col justify-between bg-brand-700 px-8 py-10 text-white lg:w-1/2 lg:px-14 lg:py-16">
        <div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-lg font-bold">
            CP
          </div>
          <h1 className="mt-8 text-2xl font-bold leading-snug lg:text-3xl">
            ระบบเบิกจ่ายค่าตอบแทน
            <br />
            การตีพิมพ์บทความผลงานทางวิชาการ
          </h1>
          <p className="mt-3 max-w-md text-brand-100">
            มหาวิทยาลัยราชภัฏชัยภูมิ ยื่นคำขอ ติดตามสถานะ และอนุมัติออนไลน์
            ตามประกาศมหาวิทยาลัยเลขที่ 2131/2566
          </p>

          <ul className="mt-8 space-y-3 text-sm text-brand-50">
            {[
              'ยื่นคำขอพร้อมแนบหลักฐานครบ 3 ประเภทในที่เดียว',
              'ติดตามได้ว่าเรื่องอยู่ขั้นไหน ใครถืออยู่ ค้างมากี่วัน',
              'เห็นวงเงินกองทุนวิจัยคงเหลือแบบเรียลไทม์',
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0">
                  <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
                </svg>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-10 text-xs text-brand-200">
          สอบถามการใช้งาน: สถาบันวิจัยและพัฒนา มหาวิทยาลัยราชภัฏชัยภูมิ
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">เข้าสู่ระบบ</h2>
            <p className="mt-1 text-sm text-slate-500">
              ใช้ชื่อผู้ใช้หรืออีเมลของมหาวิทยาลัย
            </p>
          </div>

          {error && <Alert tone="error">{error}</Alert>}

          <Field label="ชื่อผู้ใช้ หรือ อีเมล" required>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </Field>

          <Field label="รหัสผ่าน" required>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" className="w-full" loading={loading} size="lg">
            เข้าสู่ระบบ
          </Button>

          <div className="flex items-center justify-center gap-3 text-sm">
            <Link to="/forgot-password" className="text-brand-700 hover:underline">
              ลืมรหัสผ่าน
            </Link>
            <span className="text-slate-300" aria-hidden="true">
              |
            </span>
            <Link to="/register" className="font-medium text-brand-700 hover:underline">
              สมัครสมาชิก
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
