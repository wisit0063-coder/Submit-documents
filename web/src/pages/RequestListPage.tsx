import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  formatDate,
  formatMoney,
  personName,
  STATUS_LABELS,
  STATUS_TONE,
} from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '@/components/ui';
import type { Faculty, Paged, RequestStatus, RequestSummary } from '@/types';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'DRAFT', label: 'ร่าง' },
  {
    value: 'FACULTY_REVIEW,DEAN_REVIEW,RDI_REVIEW,ACADEMIC_OFFICE_REVIEW,COMMITTEE_REVIEW,PENDING_APPROVAL',
    label: 'อยู่ระหว่างพิจารณา',
  },
  { value: 'RETURNED', label: 'ตีกลับให้แก้ไข' },
  { value: 'APPROVED', label: 'อนุมัติแล้ว' },
  { value: 'PAID', label: 'จ่ายแล้ว' },
  { value: 'REJECTED,CANCELLED', label: 'ไม่อนุมัติ / ยกเลิก' },
];

const currentYear = new Date().getFullYear();
const YEARS = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

export function RequestListPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const { data: faculties } = useQuery({
    queryKey: ['faculties'],
    queryFn: () => api.get<Faculty[]>('/faculties'),
    staleTime: 30 * 60_000,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['requests', { status, year, facultyId, query, page }],
    queryFn: () =>
      api.get<Paged<RequestSummary>>('/requests', {
        status,
        year,
        facultyId,
        q: query,
        page,
        pageSize: 20,
      }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasPeerRows = (data?.items ?? []).some((item) => item.viewScope === 'SUMMARY');
  // The owner column also has to appear for a plain researcher once colleagues'
  // claims show up, otherwise those rows have no name against them.
  const canSeeOthers =
    can('ADMIN', 'FINANCE', 'RDI_OFFICER', 'ACADEMIC_OFFICE', 'APPROVER', 'DEAN', 'FACULTY_QA') ||
    hasPeerRows;

  return (
    <>
      <PageHeader
        title="คำขอรับค่าตอบแทน"
        description={
          hasPeerRows
            ? 'รายการคำขอของคุณ และคำขอที่ยื่นแล้วของเพื่อนร่วมหน่วยงาน (ของเพื่อนดูได้เฉพาะรายการย่อ ไม่แสดงจำนวนเงินและเปิดรายละเอียดไม่ได้)'
            : 'รายการคำขอที่คุณมีสิทธิ์เข้าถึง ระบบกรองตามบทบาทให้อัตโนมัติ'
        }
        action={
          can('RESEARCHER') && (
            <Link to="/requests/new">
              <Button>ยื่นคำขอใหม่</Button>
            </Link>
          )
        }
      />

      <Card className="mb-4" bodyClassName="p-4">
        {/* Filters sit in one row above the results. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="สถานะ">
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="ปีปฏิทินที่ตีพิมพ์">
            <Select
              value={year}
              onChange={(event) => {
                setYear(event.target.value);
                setPage(1);
              }}
            >
              <option value="">ทุกปี</option>
              {YEARS.map((value) => (
                <option key={value} value={value}>
                  {value + 543} ({value})
                </option>
              ))}
            </Select>
          </Field>

          {canSeeOthers && (
            <Field label="คณะ">
              <Select
                value={facultyId}
                onChange={(event) => {
                  setFacultyId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">ทุกคณะ</option>
                {faculties?.map((faculty) => (
                  <option key={faculty.id} value={faculty.id}>
                    {faculty.nameTh}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="ค้นหา">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search.trim());
                setPage(1);
              }}
              className="flex gap-2"
            >
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="เลขที่ ชื่อบทความ วารสาร DOI"
              />
              <Button type="submit" variant="outline">
                ค้นหา
              </Button>
            </form>
          </Field>
        </div>
      </Card>

      <Card bodyClassName="p-5 pt-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="ไม่พบคำขอตามเงื่อนไขที่เลือก"
            description="ลองปรับตัวกรองหรือคำค้นหาใหม่อีกครั้ง"
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>เลขที่ / วันที่ตีพิมพ์</Th>
                  {canSeeOthers && <Th>ผู้ขอ</Th>}
                  <Th>บทความ</Th>
                  <Th>ฐานข้อมูล</Th>
                  <Th>สถานะ</Th>
                  <Th className="text-right">จำนวนเงิน</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((request) => (
                  <tr key={request.id} className="hover:bg-slate-50">
                    <Td>
                      {request.viewScope === 'SUMMARY' ? (
                        // A colleague's claim from the same unit: listed so the
                        // unit can see what is in flight, but not openable.
                        <span
                          className="font-medium text-slate-600"
                          title="คำขอของเพื่อนร่วมหน่วยงาน ดูได้เฉพาะรายการย่อ"
                        >
                          {request.requestNo}
                        </span>
                      ) : (
                        <Link
                          to={`/requests/${request.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {request.requestNo}
                        </Link>
                      )}
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {formatDate(request.publishedAt)}
                      </span>
                    </Td>
                    {canSeeOthers && (
                      <Td>
                        <span className="text-slate-700">{personName(request.owner)}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {request.faculty.nameTh}
                        </span>
                      </Td>
                    )}
                    <Td className="max-w-sm">
                      <span className="line-clamp-2 text-slate-800">{request.articleTitle}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {request.journalName}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-600">{request.journalTier.nameTh}</span>
                    </Td>
                    <Td>
                      <Badge className={STATUS_TONE[request.status as RequestStatus]}>
                        {STATUS_LABELS[request.status as RequestStatus]}
                      </Badge>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {request.viewScope === 'SUMMARY' ? (
                        <span className="text-xs text-slate-400">ไม่แสดง</span>
                      ) : request.amountApproved !== null ? (
                        <>
                          <span className="font-medium text-emerald-700">
                            {formatMoney(request.amountApproved, false)}
                          </span>
                          {request.amountApproved !== request.amountRequested && (
                            <span className="mt-0.5 block text-xs text-slate-400 line-through">
                              {formatMoney(request.amountRequested, false)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-600">{formatMoney(request.amountRequested, false)}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>
                ทั้งหมด {data.total.toLocaleString('th-TH')} รายการ · หน้า {data.page} / {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  ก่อนหน้า
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  ถัดไป
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
