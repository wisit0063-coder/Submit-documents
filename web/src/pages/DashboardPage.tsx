import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuth, REVIEWER_ROLES } from '@/lib/auth';
import { formatMoney, personName, STATUS_LABELS, STATUS_TONE } from '@/lib/format';
import { axisProps, gridProps, monthLabel, SERIES, tooltipStyle } from '@/lib/chart';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import type { BudgetSummary, Paged, RequestStatus, RequestSummary } from '@/types';

/**
 * Whose requests the numbers count - the server decides it from the caller's
 * roles, the page only puts it into words.
 */
type DashboardScope = 'UNIVERSITY' | 'FACULTY' | 'OWN';

const SCOPE_LABELS: Record<DashboardScope, string> = {
  OWN: 'ตัวเลขด้านล่างนับเฉพาะคำขอของคุณ',
  FACULTY: 'ตัวเลขด้านล่างนับคำขอทั้งคณะที่คุณดูแล (รวมคำขอของคุณเอง ไม่รวมฉบับร่างของผู้อื่น)',
  UNIVERSITY: 'ตัวเลขด้านล่างนับคำขอทั้งมหาวิทยาลัย',
};

interface DashboardData {
  scope: DashboardScope;
  counts: Record<RequestStatus, number>;
  activeBudgetYear: number | null;
  monthly: { month: string; count: number; amount: number }[];
}

/** One number with its label - used instead of a chart when the story is a single value. */
function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'brand' | 'warning' | 'success';
}) {
  const tones = {
    default: 'text-slate-900',
    brand: 'text-brand-700',
    warning: 'text-amber-700',
    success: 'text-emerald-700',
  };
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { user, quota, can } = useAuth();
  const isReviewer = Boolean(user?.roles.some((role) => REVIEWER_ROLES.includes(role)));
  // Same test the sidebar and the claim list use: somebody who only files
  // claims. Their "recent" card asks for their own rows alone, because the
  // unsummarised list also carries colleagues' submitted claims, and a person
  // who has never filed anything would otherwise open the dashboard to five
  // rows belonging to other people.
  const isPlainRequester = !can(...REVIEWER_ROLES, 'FINANCE', 'ADMIN') && can('RESEARCHER');

  const {
    data: dashboard,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
  });

  const { data: recent } = useQuery({
    queryKey: ['requests', 'recent', isPlainRequester],
    queryFn: () =>
      api.get<Paged<RequestSummary>>('/requests', {
        pageSize: 5,
        ...(isPlainRequester ? { mine: '1' } : {}),
      }),
  });

  const { data: inbox } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.get<RequestSummary[]>('/approvals/inbox'),
    enabled: isReviewer,
  });

  const { data: budget } = useQuery({
    queryKey: ['budget-summary'],
    queryFn: () => api.get<BudgetSummary>('/budget/summary'),
    enabled: can('FINANCE', 'ADMIN', 'APPROVER'),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-7 w-7 text-brand-600" />
      </div>
    );
  }

  // Without this, a failed load rendered every tile as 0 - telling a dean there
  // was nothing waiting when the numbers had simply not arrived.
  if (isError) {
    return (
      <>
        <PageHeader title={`สวัสดี ${user?.fullName ?? ''}`} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  const counts = dashboard?.counts ?? ({} as Record<RequestStatus, number>);
  const inFlight =
    (counts.FACULTY_REVIEW ?? 0) +
    (counts.DEAN_REVIEW ?? 0) +
    (counts.RDI_REVIEW ?? 0) +
    (counts.ACADEMIC_OFFICE_REVIEW ?? 0) +
    (counts.COMMITTEE_REVIEW ?? 0) +
    (counts.PENDING_APPROVAL ?? 0);

  const monthly = (dashboard?.monthly ?? []).map((row) => ({
    ...row,
    label: monthLabel(row.month),
  }));

  // Status breakdown as a ranked list, not a pie: the values are close together
  // and the labels matter more than the wedges.
  const statusRows = (Object.entries(counts) as [RequestStatus, number][])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  const statusMax = Math.max(1, ...statusRows.map(([, value]) => value));

  return (
    <>
      <PageHeader
        title={`สวัสดี ${user?.fullName ?? ''}`}
        description={
          dashboard?.activeBudgetYear
            ? `ปีงบประมาณที่เปิดใช้งาน ${dashboard.activeBudgetYear}`
            : 'ยังไม่ได้ตั้งวงเงินปีงบประมาณ'
        }
        action={
          can('RESEARCHER') && (
            <Link to="/requests/new">
              <Button>ยื่นคำขอใหม่</Button>
            </Link>
          )
        }
      />

      {dashboard?.scope && (
        <p className="mb-3 text-sm text-slate-500">{SCOPE_LABELS[dashboard.scope]}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {can('RESEARCHER') && quota && (
          <StatTile
            label={`สิทธิ์คงเหลือปี ${quota.calendarYear}`}
            value={`${quota.remaining} / ${quota.limit}`}
            sub={`ใช้แล้ว ${quota.used} เรื่อง · อยู่ระหว่างพิจารณา ${quota.pending} เรื่อง`}
            tone={quota.remaining === 0 ? 'warning' : 'brand'}
          />
        )}
        <StatTile label="อยู่ระหว่างดำเนินการ" value={String(inFlight)} sub="ทุกขั้นตอนรวมกัน" />
        <StatTile
          label="ตีกลับให้แก้ไข"
          value={String(counts.RETURNED ?? 0)}
          tone={(counts.RETURNED ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label="อนุมัติแล้ว"
          value={String((counts.APPROVED ?? 0) + (counts.PAID ?? 0))}
          sub={`บันทึกการเบิกจ่ายแล้ว ${counts.PAID ?? 0} เรื่อง`}
          tone="success"
        />
      </div>

      {budget?.isStale && (
        <div className="mb-4">
          <Alert tone="warning" title="ปีงบประมาณที่เปิดใช้งานไม่ตรงกับปัจจุบัน">
            ปีงบที่เปิดใช้งานคือ <strong>{budget.year}</strong> แต่วันนี้อยู่ในปีงบ{' '}
            <strong>{budget.fiscalYearNow}</strong> แล้ว · คำขอใหม่จะได้เลขที่ผิดปีและตัดวงเงินของปีที่ปิดแล้ว
            · ไปที่เมนู <strong>งบประมาณ</strong> เพื่อสร้างปีงบใหม่
          </Alert>
        </div>
      )}

      {budget && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="วงเงินตั้งต้น" value={formatMoney(budget.total, false)} sub="บาท" />
          <StatTile label="ยอดจอง (อนุมัติแล้วรอจ่าย)" value={formatMoney(budget.reserved, false)} sub="บาท" />
          <StatTile label="ยอดจ่ายจริง" value={formatMoney(budget.paid, false)} sub="บาท" />
          <StatTile
            label="คงเหลือใช้ได้"
            value={formatMoney(budget.available, false)}
            sub="บาท"
            tone={budget.available <= 0 ? 'warning' : 'success'}
          />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card
          title="คำขอที่ยื่นรายเดือน"
          description="นับตามวันที่ยื่น ย้อนหลังไม่เกิน 12 เดือน"
          className="lg:col-span-2"
        >
          {monthly.length === 0 ? (
            <EmptyState title="ยังไม่มีข้อมูลการยื่นคำขอ" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 16, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                  <YAxis {...axisProps} allowDecimals={false} width={40} />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number) => [`${value} เรื่อง`, 'จำนวนคำขอ']}
                  />
                  {/* One series, so one colour and no legend - the title names it. */}
                  <Bar dataKey="count" fill={SERIES.blue} radius={[4, 4, 0, 0]} maxBarSize={34}>
                    <LabelList
                      dataKey="count"
                      position="top"
                      style={{ fill: '#475569', fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="คำขอแยกตามสถานะ">
          {statusRows.length === 0 ? (
            <EmptyState title="ยังไม่มีคำขอในระบบ" />
          ) : (
            <ul className="space-y-2.5">
              {statusRows.map(([status, value]) => (
                <li key={status}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-700">{STATUS_LABELS[status]}</span>
                    <span className="font-semibold tabular-nums text-slate-900">{value}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${(value / statusMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isReviewer && (
        <Card
          title="คิวงานที่รอคุณพิจารณา"
          description="เรียงจากเรื่องที่ค้างนานที่สุด"
          className="mt-5"
          action={
            <Link to="/inbox">
              <Button variant="outline" size="sm">
                ดูทั้งหมด
              </Button>
            </Link>
          }
        >
          {!inbox || inbox.length === 0 ? (
            <EmptyState title="ไม่มีงานค้างในคิวของคุณ" description="เมื่อมีคำขอเข้ามาจะแสดงที่นี่" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>เลขที่</Th>
                  <Th>ผู้ขอ</Th>
                  <Th>บทความ</Th>
                  <Th className="text-right">ค้าง (วันทำการ)</Th>
                </tr>
              </thead>
              <tbody>
                {inbox.slice(0, 5).map((request) => (
                  <tr key={request.id} className="hover:bg-slate-50">
                    <Td>
                      <Link to={`/requests/${request.id}`} className="font-medium text-brand-700 hover:underline">
                        {request.requestNo}
                      </Link>
                    </Td>
                    <Td>{personName(request.owner)}</Td>
                    <Td className="max-w-md">
                      <span className="line-clamp-2 text-slate-700">{request.articleTitle}</span>
                    </Td>
                    <Td className="text-right">
                      <span
                        className={
                          (request.waitingBusinessDays ?? 0) >= 5
                            ? 'font-semibold text-rose-600'
                            : 'text-slate-700'
                        }
                      >
                        {request.waitingBusinessDays ?? 0}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Card
        title="คำขอล่าสุด"
        className="mt-5"
        action={
          <Link to="/requests">
            <Button variant="outline" size="sm">
              ดูทั้งหมด
            </Button>
          </Link>
        }
      >
        {!recent || recent.items.length === 0 ? (
          <EmptyState
            title="ยังไม่มีคำขอ"
            description="เริ่มต้นด้วยการยื่นคำขอรับค่าตอบแทนการตีพิมพ์บทความ"
            action={
              can('RESEARCHER') && (
                <Link to="/requests/new">
                  <Button>ยื่นคำขอใหม่</Button>
                </Link>
              )
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>เลขที่</Th>
                <Th>บทความ</Th>
                <Th>สถานะ</Th>
                <Th className="text-right">จำนวนเงิน</Th>
              </tr>
            </thead>
            <tbody>
              {recent.items.map((request) => (
                <tr key={request.id} className="hover:bg-slate-50">
                  <Td>
                    {/* summariseForPeers marks rows the detail endpoint will
                        refuse; linking them produced a permission error that
                        reads as a broken system. */}
                    {request.viewScope === 'SUMMARY' ? (
                      <span className="font-medium text-slate-500">{request.requestNo}</span>
                    ) : (
                      <Link to={`/requests/${request.id}`} className="font-medium text-brand-700 hover:underline">
                        {request.requestNo}
                      </Link>
                    )}
                  </Td>
                  <Td className="max-w-md">
                    <span className="line-clamp-2 text-slate-700">{request.articleTitle}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{request.journalName}</span>
                  </Td>
                  <Td>
                    <Badge className={STATUS_TONE[request.status]}>{STATUS_LABELS[request.status]}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatMoney(request.amountApproved ?? request.amountRequested, false)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
