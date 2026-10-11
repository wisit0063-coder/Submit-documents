import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate, personName, STATUS_LABELS, STATUS_TONE } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import type { RequestSummary } from '@/types';

/**
 * The queue of work waiting on this person, oldest first. Anything past five
 * business days is the same threshold the daily reminder cron uses, so the two
 * never disagree about what counts as overdue.
 */
export function InboxPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<RequestSummary[]>('/approvals/inbox'),
  });

  const overdue = (data ?? []).filter((item) => (item.waitingBusinessDays ?? 0) >= 5);

  return (
    <>
      <PageHeader
        title="คิวงานของฉัน"
        description="คำขอที่รอการพิจารณาของคุณ เรียงจากเรื่องที่ค้างนานที่สุด"
      />

      {overdue.length > 0 && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-inset ring-rose-200">
          มี {overdue.length} เรื่องค้างเกิน 5 วันทำการ ระบบจะส่งอีเมลเตือนในรอบถัดไป
        </div>
      )}

      <Card bodyClassName="p-5 pt-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            title="ไม่มีงานค้างในคิวของคุณ"
            description="เมื่อมีคำขอเข้าสู่ขั้นตอนที่คุณรับผิดชอบ รายการจะแสดงที่นี่"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>เลขที่</Th>
                <Th>ผู้ขอ / คณะ</Th>
                <Th>บทความ</Th>
                <Th>ขั้นตอน</Th>
                <Th className="text-right">ค้าง (วันทำการ)</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((request) => {
                const waiting = request.waitingBusinessDays ?? 0;
                return (
                  <tr key={request.id} className="hover:bg-slate-50">
                    <Td>
                      <Link
                        to={`/requests/${request.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {request.requestNo}
                      </Link>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        ตีพิมพ์ {formatDate(request.publishedAt)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-slate-700">{personName(request.owner)}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {request.faculty.nameTh}
                      </span>
                    </Td>
                    <Td className="max-w-sm">
                      <span className="line-clamp-2 text-slate-800">{request.articleTitle}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {request.journalName}
                      </span>
                    </Td>
                    <Td>
                      <Badge className={STATUS_TONE[request.status]}>
                        {request.stepLabel || STATUS_LABELS[request.status]}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <span
                        className={
                          waiting >= 5
                            ? 'font-semibold tabular-nums text-rose-600'
                            : 'tabular-nums text-slate-700'
                        }
                      >
                        {waiting}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
