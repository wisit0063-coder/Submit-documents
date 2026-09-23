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
