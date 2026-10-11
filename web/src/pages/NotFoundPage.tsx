import { Link } from 'react-router-dom';
import { Button, EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      title="ไม่พบหน้าที่ต้องการ"
      description="หน้าที่คุณเรียกอาจถูกย้ายหรือคุณไม่มีสิทธิ์เข้าถึง"
      action={
        <Link to="/">
          <Button variant="outline">กลับสู่หน้าภาพรวม</Button>
        </Link>
      }
    />
  );
}

/**
 * Shown when a signed-in user reaches a page their roles do not cover, usually
 * by typing the address. Previously the page itself rendered and every request
 * inside it came back with a permission error, which reads as a broken system
 * rather than a closed door.
 */
export function ForbiddenPage() {
  return (
    <EmptyState
      title="คุณไม่มีสิทธิ์เข้าถึงหน้านี้"
      description="หน้านี้เปิดให้เฉพาะบางตำแหน่ง หากคิดว่าควรเข้าได้ ให้ติดต่อผู้ดูแลระบบเพื่อขอมอบหมายบทบาท"
      action={
        <Link to="/">
          <Button variant="outline">กลับสู่หน้าภาพรวม</Button>
        </Link>
      }
    />
  );
}
