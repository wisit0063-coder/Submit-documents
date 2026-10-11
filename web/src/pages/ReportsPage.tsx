import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMoney } from '@/lib/format';
import { claimableYears } from '@/lib/years';
import { axisProps, gridProps, moneyTick, SERIES, tooltipStyle } from '@/lib/chart';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import type { Faculty } from '@/types';

interface FacultyRow {
  facultyId: string;
  facultyName: string;
  totalRequests: number;
  approvedCount: number;
  paidCount: number;
  amountRequested: number;
  amountApproved: number;
  amountPaid: number;
}

interface TierRow {
  tierId: string;
  code: string;
  tierName: string;
  databaseName: string;
  isActive: boolean;
  totalRequests: number;
  approvedCount: number;
  amountApproved: number;
}

interface ProcessingTime {
  steps: {
    status: string;
    stepLabel: string;
    samples: number;
    averageBusinessDays: number;
    maxBusinessDays: number;
  }[];
  overallAverageBusinessDays: number;
  sampleSize: number;
}

interface QaRow {
  facultyName: string;
  year: number;
  count: number;
  byDatabase: Record<string, number>;
}

type TabKey = 'faculty' | 'tier' | 'processing' | 'qa';

const YEARS = claimableYears();

/** Shortens a faculty name so the y-axis stays readable. */
const shortName = (name: string) => name.replace('คณะ', '').replace('มหาวิทยาลัย', '').trim();

export function ReportsPage() {
  const { can } = useAuth();
  // A dean holds both: the faculty tab opens first because it is the wider one.
  const canFaculty = can('ADMIN', 'FINANCE', 'APPROVER', 'RDI_OFFICER', 'DEAN', 'ACADEMIC_OFFICE');
  const canQa = can('FACULTY_QA', 'ADMIN', 'DEAN');
  const [tab, setTab] = useState<TabKey>(canFaculty ? 'faculty' : 'qa');
  const [year, setYear] = useState('');
  const [facultyId, setFacultyId] = useState('');

  const filters = { year: year || undefined, facultyId: facultyId || undefined };

  const { data: faculties } = useQuery({
    queryKey: ['faculties'],
    queryFn: () => api.get<Faculty[]>('/faculties'),
    staleTime: 30 * 60_000,
  });

  const byFaculty = useQuery({
    queryKey: ['report-faculty', filters],
    queryFn: () => api.get<FacultyRow[]>('/reports/by-faculty', filters),
    enabled: tab === 'faculty' && canFaculty,
  });

  const byTier = useQuery({
    queryKey: ['report-tier', filters],
    queryFn: () => api.get<TierRow[]>('/reports/by-tier', filters),
    enabled: tab === 'tier' && can('ADMIN', 'FINANCE'),
  });

  const processing = useQuery({
    queryKey: ['report-processing', filters],
    queryFn: () => api.get<ProcessingTime>('/reports/processing-time', filters),
    enabled: tab === 'processing' && can('ADMIN', 'RDI_OFFICER'),
  });

  const qa = useQuery({
    queryKey: ['report-qa', filters],
    queryFn: () => api.get<QaRow[]>('/reports/qa-indicator', filters),
    enabled: tab === 'qa' && canQa,
  });

  const tabs: { key: TabKey; label: string; visible: boolean }[] = [
    { key: 'faculty', label: 'รายคณะ', visible: canFaculty },
    { key: 'tier', label: 'ตามฐานข้อมูลวารสาร', visible: can('ADMIN', 'FINANCE') },
    { key: 'processing', label: 'เวลาที่ใช้แต่ละขั้น', visible: can('ADMIN', 'RDI_OFFICER') },
    { key: 'qa', label: 'ตัวชี้วัดประกันคุณภาพ', visible: canQa },
  ];

  const exportUrl = () => {
    const params = new URLSearchParams();
    if (year) params.set('year', year);
    if (facultyId) params.set('facultyId', facultyId);
    return api.fileUrl(`/reports/export?${params.toString()}`);
  };

  return (
    <>
      <PageHeader
        title="รายงาน"
        description="สรุปผลการเบิกจ่ายค่าตอบแทนการตีพิมพ์ ตามคณะ ฐานข้อมูล และระยะเวลาดำเนินการ"
        action={
          can('ADMIN', 'FINANCE', 'FACULTY_QA') && (
            <a href={exportUrl()} target="_blank" rel="noreferrer">
              <Button variant="outline">ส่งออก Excel</Button>
            </a>
          )
        }
      />

      <Card className="mb-4" bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="ปีปฏิทิน">
            <Select value={year} onChange={(event) => setYear(event.target.value)}>
              <option value="">ทุกปี</option>
              {YEARS.map((value) => (
                <option key={value} value={value}>
                  {value + 543} ({value})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="คณะ">
            <Select value={facultyId} onChange={(event) => setFacultyId(event.target.value)}>
              <option value="">ทุกคณะ</option>
              {faculties?.map((faculty) => (
                <option key={faculty.id} value={faculty.id}>
                  {faculty.nameTh}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {tabs
          .filter((item) => item.visible)
          .map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === item.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
      </div>

      {tab === 'faculty' && (
        <Card
          title="จำนวนเงินรายคณะ"
          description="เปรียบเทียบยอดที่อนุมัติกับยอดที่จ่ายจริง"
        >
          {byFaculty.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : byFaculty.isError ? (
            <ErrorState error={byFaculty.error} onRetry={() => void byFaculty.refetch()} />
          ) : !byFaculty.data || byFaculty.data.length === 0 ? (
            <EmptyState title="ยังไม่มีข้อมูลตามเงื่อนไขที่เลือก" />
          ) : (
            <>
              <div style={{ height: Math.max(240, byFaculty.data.length * 56) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byFaculty.data.map((row) => ({ ...row, name: shortName(row.facultyName) }))}
                    layout="vertical"
                    margin={{ top: 8, right: 24, bottom: 0, left: 8 }}
                    barGap={2}
                  >
                    <CartesianGrid {...gridProps} horizontal={false} vertical />
                    <XAxis type="number" {...axisProps} tickFormatter={moneyTick} />
                    <YAxis type="category" dataKey="name" {...axisProps} width={120} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: number, name: string) => [formatMoney(value), name]}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Bar dataKey="amountApproved" name="อนุมัติ" fill={SERIES.blue} radius={[0, 4, 4, 0]} maxBarSize={16} />
                    <Bar dataKey="amountPaid" name="จ่ายจริง" fill={SERIES.orange} radius={[0, 4, 4, 0]} maxBarSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Table className="mt-4">
                <thead>
                  <tr>
                    <Th>คณะ</Th>
                    <Th className="text-right">คำขอทั้งหมด</Th>
                    <Th className="text-right">อนุมัติแล้ว</Th>
                    <Th className="text-right">จ่ายแล้ว</Th>
                    <Th className="text-right">ยอดอนุมัติ</Th>
                    <Th className="text-right">ยอดจ่ายจริง</Th>
                  </tr>
                </thead>
                <tbody>
                  {byFaculty.data.map((row) => (
                    <tr key={row.facultyId} className="hover:bg-slate-50">
                      <Td>{row.facultyName}</Td>
                      <Td className="text-right tabular-nums">{row.totalRequests}</Td>
                      <Td className="text-right tabular-nums">{row.approvedCount}</Td>
                      <Td className="text-right tabular-nums">{row.paidCount}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(row.amountApproved, false)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(row.amountPaid, false)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </Card>
      )}

      {tab === 'tier' && (
        <Card title="การเบิกตามฐานข้อมูลวารสาร" description="ยอดอนุมัติสะสมของแต่ละฐานข้อมูล">
          {byTier.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : byTier.isError ? (
            <ErrorState error={byTier.error} onRetry={() => void byTier.refetch()} />
          ) : !byTier.data || byTier.data.length === 0 ? (
            <EmptyState title="ยังไม่มีข้อมูลตามเงื่อนไขที่เลือก" />
          ) : (
            <>
              <div style={{ height: Math.max(240, byTier.data.length * 48) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byTier.data}
                    layout="vertical"
                    margin={{ top: 8, right: 24, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid {...gridProps} horizontal={false} vertical />
                    <XAxis type="number" {...axisProps} tickFormatter={moneyTick} />
                    <YAxis type="category" dataKey="code" {...axisProps} width={100} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: number) => [formatMoney(value), 'ยอดอนุมัติ']}
                    />
                    {/* One series: one colour for every bar, never a value ramp. */}
                    <Bar dataKey="amountApproved" fill={SERIES.blue} radius={[0, 4, 4, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Table className="mt-4">
                <thead>
                  <tr>
                    <Th>ฐานข้อมูล</Th>
                    <Th className="text-right">คำขอทั้งหมด</Th>
                    <Th className="text-right">อนุมัติแล้ว</Th>
                    <Th className="text-right">ยอดอนุมัติ</Th>
                  </tr>
                </thead>
                <tbody>
                  {byTier.data.map((row) => (
                    <tr key={row.tierId} className="hover:bg-slate-50">
                      <Td>
                        {row.tierName}
                        {!row.isActive && (
                          <span className="ml-2 text-xs text-slate-400">(ปิดรับแล้ว)</span>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">{row.totalRequests}</Td>
                      <Td className="text-right tabular-nums">{row.approvedCount}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(row.amountApproved, false)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </Card>
      )}

      {tab === 'processing' && (
        <Card
          title="เวลาเฉลี่ยที่ใช้ในแต่ละขั้น"
          description={
            processing.data
              ? `จากคำขอ ${processing.data.sampleSize} เรื่อง เฉลี่ยทั้งกระบวนการ ${processing.data.overallAverageBusinessDays} วันทำการ`
              : 'หาคอขวดของกระบวนการ'
          }
        >
          {processing.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : processing.isError ? (
            <ErrorState error={processing.error} onRetry={() => void processing.refetch()} />
          ) : !processing.data || processing.data.steps.length === 0 ? (
            <EmptyState title="ยังไม่มีข้อมูลเพียงพอสำหรับคำนวณ" />
          ) : (
            <>
              <div style={{ height: Math.max(220, processing.data.steps.length * 52) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={processing.data.steps}
                    layout="vertical"
                    margin={{ top: 8, right: 40, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid {...gridProps} horizontal={false} vertical />
                    <XAxis type="number" {...axisProps} unit=" วัน" />
                    <YAxis type="category" dataKey="stepLabel" {...axisProps} width={160} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: number) => [`${value} วันทำการ`, 'เฉลี่ย']}
                    />
                    <Bar
                      dataKey="averageBusinessDays"
                      fill={SERIES.blue}
                      radius={[0, 4, 4, 0]}
                      maxBarSize={18}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Table className="mt-4">
                <thead>
                  <tr>
                    <Th>ขั้นตอน</Th>
                    <Th className="text-right">จำนวนตัวอย่าง</Th>
                    <Th className="text-right">เฉลี่ย (วันทำการ)</Th>
                    <Th className="text-right">นานที่สุด</Th>
                  </tr>
                </thead>
                <tbody>
                  {processing.data.steps.map((step) => (
                    <tr key={step.status} className="hover:bg-slate-50">
                      <Td>{step.stepLabel}</Td>
                      <Td className="text-right tabular-nums">{step.samples}</Td>
                      <Td className="text-right tabular-nums">
                        <span className={step.averageBusinessDays >= 5 ? 'font-semibold text-rose-600' : ''}>
                          {step.averageBusinessDays}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{step.maxBusinessDays}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </Card>
      )}

      {tab === 'qa' && (
        <Card
          title="จำนวนบทความตีพิมพ์รายปี"
          description="สำหรับงานประกันคุณภาพ นับเฉพาะคำขอที่อนุมัติแล้ว ใช้ปีตัวชี้วัดที่คณะบันทึกไว้"
        >
          {qa.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : qa.isError ? (
            <ErrorState error={qa.error} onRetry={() => void qa.refetch()} />
          ) : !qa.data || qa.data.length === 0 ? (
            <EmptyState title="ยังไม่มีข้อมูลตามเงื่อนไขที่เลือก" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>ปี</Th>
                  <Th>คณะ</Th>
                  <Th className="text-right">จำนวนบทความ</Th>
                  <Th>แยกตามฐานข้อมูล</Th>
                </tr>
              </thead>
              <tbody>
                {qa.data.map((row) => (
                  <tr key={`${row.facultyName}-${row.year}`} className="hover:bg-slate-50">
                    <Td className="tabular-nums">{row.year}</Td>
                    <Td>{row.facultyName}</Td>
                    <Td className="text-right font-semibold tabular-nums">{row.count}</Td>
                    <Td>
                      <span className="text-xs text-slate-600">
                        {Object.entries(row.byDatabase)
                          .map(([database, count]) => `${database} ${count}`)
                          .join(' · ')}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
