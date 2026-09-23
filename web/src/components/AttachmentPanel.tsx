import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DOC_TYPE_LABELS, REQUIRED_DOC_TYPES, formatDate, formatFileSize } from '@/lib/format';
import { Alert, Badge, Button, useToast } from '@/components/ui';
import type { Attachment, DocType, RequestDetail } from '@/types';

const ALL_DOC_TYPES: DocType[] = [...REQUIRED_DOC_TYPES, 'ADDITIONAL'];

const DOC_TYPE_HINTS: Record<DocType, string> = {
  ACCEPTANCE_LETTER: 'หนังสือตอบรับการตีพิมพ์จากบรรณาธิการวารสาร',
  ARTICLE_COPY: 'สำเนาบทความฉบับเต็มที่เผยแพร่แล้ว',
  DATABASE_PROOF: 'หลักฐานแสดงฐานข้อมูลวารสาร ต้องปรากฏวันที่ตีพิมพ์',
  ADDITIONAL: 'เอกสารเพิ่มเติมตามที่ผู้ตรวจสอบร้องขอ',
};

/**
 * Upload and review panel for the three mandatory documents.
 *
 * Files are never linked to directly: downloads go through
 * /attachments/:id/download so permissions are checked on every open.
 */
export function AttachmentPanel({
  request,
  canEdit,
}: {
  request: RequestDetail;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can, user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<DocType | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const isOwner = user?.id === request.userId;
  const canVerify = can('RDI_OFFICER', 'ADMIN') && request.status !== 'DRAFT';

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['request', String(request.id)] });

  const upload = useMutation({
    mutationFn: async ({ docType, file }: { docType: DocType; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('docType', docType);
      return api.upload<Attachment>(`/requests/${request.id}/attachments`, formData);
    },
    onSuccess: async () => {
      await refresh();
      toast.push('success', 'อัปโหลดไฟล์เรียบร้อยแล้ว');
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'อัปโหลดไม่สำเร็จ');
    },
    onSettled: () => setUploadingType(null),
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) => api.delete(`/attachments/${attachmentId}`),
    onSuccess: async () => {
      await refresh();
      toast.push('success', 'ลบไฟล์แล้ว');
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : 'ลบไฟล์ไม่สำเร็จ'),
  });

  const verify = useMutation({
    mutationFn: ({ attachmentId, isVerified }: { attachmentId: string; isVerified: boolean }) =>
      api.patch(`/attachments/${attachmentId}/verify`, { isVerified }),
    onSuccess: async () => {
      await refresh();
      toast.push('success', 'บันทึกผลการตรวจสอบแล้ว');
    },
  });

  const handlePick = (docType: DocType, fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    setUploadingType(docType);
    upload.mutate({ docType, file });
  };

  const byType = (docType: DocType) => request.attachments.filter((file) => file.docType === docType);

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      {ALL_DOC_TYPES.map((docType) => {
        const files = byType(docType);
        const required = REQUIRED_DOC_TYPES.includes(docType);
        const missing = required && files.length === 0;

        return (
          <div
            key={docType}
            className={`rounded-lg border p-4 ${missing ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {DOC_TYPE_LABELS[docType]}
                  {required && <span className="text-rose-500">*</span>}
                  {missing && (
                    <Badge className="bg-amber-100 text-amber-800 ring-amber-200">ยังไม่ได้แนบ</Badge>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{DOC_TYPE_HINTS[docType]}</p>
              </div>

              {canEdit && isOwner && (
                <>
                  <input
                    ref={(element) => {
                      inputRefs.current[docType] = element;
                    }}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(event) => {
                      handlePick(docType, event.target.files);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={uploadingType === docType}
                    onClick={() => inputRefs.current[docType]?.click()}
                  >
                    {files.length > 0 && docType !== 'ADDITIONAL' ? 'แทนที่ไฟล์' : 'แนบไฟล์'}
                  </Button>
                </>
              )}
            </div>

            {files.length > 0 && (
              <ul className="mt-3 space-y-2">
                {files.map((file) => (
                  <li
                    key={file.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-5 w-5 shrink-0 text-slate-400"
                    >
                      <path
                        d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4z"
                        strokeLinejoin="round"
                      />
                      <path d="M14 3v4h4" strokeLinejoin="round" />
                    </svg>

                    <div className="min-w-0 flex-1">
                      <a
                        href={api.fileUrl(`/attachments/${file.id}/download`)}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-sm font-medium text-brand-700 hover:underline"
                      >
                        {file.fileName}
                      </a>
                      <span className="text-xs text-slate-500">
                        {formatFileSize(file.fileSize)} · อัปโหลด {formatDate(file.createdAt)}
                      </span>
                    </div>

                    {file.isVerified && (
                      <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                        ตรวจสอบแล้ว
                      </Badge>
                    )}

                    {canVerify && (
                      <Button
                        type="button"
                        size="sm"
                        variant={file.isVerified ? 'ghost' : 'outline'}
                        onClick={() =>
                          verify.mutate({ attachmentId: file.id, isVerified: !file.isVerified })
                        }
                      >
                        {file.isVerified ? 'ยกเลิกการตรวจ' : 'ทำเครื่องหมายว่าตรวจแล้ว'}
                      </Button>
                    )}

                    {canEdit && isOwner && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-rose-600 hover:bg-rose-50"
                        onClick={() => remove.mutate(file.id)}
                      >
                        ลบ
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
