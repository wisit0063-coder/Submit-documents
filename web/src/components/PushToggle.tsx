import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { disablePush, enablePush, readPushState, sendTestPush, syncPush, type PushState } from '@/lib/push';
import { Button, useToast } from '@/components/ui';

/**
 * The "turn on notifications" control in the top bar (CLAUDE.md ข้อ 10).
 *
 * It has to be a button the person clicks: Chrome refuses a permission prompt a
 * page raises by itself. Once allowed, the browser is re-bound to whoever signs
 * in on it without asking again, unless that person switched popups off here.
 */

function Bell({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function PushToggle() {
  const { user } = useAuth();
  const toast = useToast();
  const userId = user ? String(user.id) : null;

  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // On sign-in, re-bind this browser to the person now using it - quietly, and
  // only if they already allowed popups here and did not switch them off.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    syncPush(userId)
      .catch(() => readPushState(userId))
      .catch((): PushState => 'off')
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId || state === null) return null;
  // Nothing to offer: the browser cannot do it, or the server has no keys.
  if (state === 'unsupported' || state === 'unavailable') return null;

  if (state === 'insecure') {
    return (
      <span
        className="hidden items-center gap-1.5 text-xs text-slate-400 md:inline-flex"
        title="การแจ้งเตือนแบบป๊อปอัปใช้ได้เมื่อเปิดผ่าน https หรือ localhost เท่านั้น"
      >
        <Bell muted /> แจ้งเตือนต้องใช้ https
      </span>
    );
  }

  if (state === 'denied') {
    return (
      <span
        className="hidden items-center gap-1.5 text-xs text-slate-500 md:inline-flex"
        title="กดไอคอนแม่กุญแจหน้าช่องที่อยู่เว็บ แล้วเปลี่ยน 'การแจ้งเตือน' เป็น 'อนุญาต'"
      >
        <Bell muted /> การแจ้งเตือนถูกบล็อก
      </span>
    );
  }

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await enablePush(userId);
      setState(next);
      if (next === 'on') toast.push('success', 'เปิดการแจ้งเตือนบนเครื่องนี้แล้ว');
      else if (next === 'denied') toast.push('error', 'การแจ้งเตือนถูกบล็อก เปิดได้ที่การตั้งค่าของเบราว์เซอร์');
    } catch (error) {
      toast.push('error', error instanceof ApiError ? error.message : 'เปิดการแจ้งเตือนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'off') {
    return (
      <Button variant="outline" size="sm" loading={busy} onClick={() => void turnOn()}>
        <Bell />
        <span className="hidden sm:inline">เปิดการแจ้งเตือน</span>
      </Button>
    );
  }

  // state === 'on'
  const test = async () => {
    setMenuOpen(false);
    try {
      const result = await sendTestPush();
      if (result.delivered > 0) toast.push('success', 'ส่งแล้ว ป๊อปอัปจะขึ้นที่มุมจอในไม่กี่วินาที');
      else toast.push('error', 'ส่งไม่ถึงเครื่องนี้ ลองปิดแล้วเปิดการแจ้งเตือนใหม่อีกครั้ง');
    } catch (error) {
      toast.push('error', error instanceof ApiError ? error.message : 'ส่งทดสอบไม่สำเร็จ');
    }
  };

  const turnOff = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      await disablePush(userId, true);
      setState('off');
      toast.push('success', 'ปิดการแจ้งเตือนบนเครื่องนี้แล้ว');
    } catch {
      toast.push('error', 'ปิดการแจ้งเตือนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        title="การแจ้งเตือนเปิดอยู่บนเครื่องนี้"
      >
        <span className="text-emerald-600">
          <Bell />
        </span>
        <span className="hidden sm:inline">แจ้งเตือนเปิดอยู่</span>
      </Button>
      {menuOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="ปิดเมนู"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            <button
              type="button"
              className="w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => void test()}
            >
              ส่งการแจ้งเตือนทดสอบ
            </button>
            <button
              type="button"
              className="w-full rounded px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
              onClick={() => void turnOff()}
            >
              ปิดการแจ้งเตือนบนเครื่องนี้
            </button>
          </div>
        </>
      )}
    </div>
  );
}
