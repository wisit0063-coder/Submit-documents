# API Endpoints

ระบบเบิกจ่ายค่าตอบแทนการตีพิมพ์บทความผลงานทางวิชาการ มหาวิทยาลัยราชภัฏชัยภูมิ

Base URL: `/api`
รูปแบบ: REST + JSON, ยืนยันตัวตนด้วย JWT ใน httpOnly cookie

---

## 1. Authentication

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| POST | `/auth/login` | public | ล็อกอินด้วย username/password ออก cookie |
| POST | `/auth/logout` | ทุกคน | ล้าง cookie |
| GET | `/auth/me` | ทุกคน | ข้อมูลผู้ใช้ปัจจุบัน + roles + สิทธิ์คงเหลือปีนี้ |
| POST | `/auth/change-password` | ทุกคน | เปลี่ยนรหัสผ่าน (บังคับครั้งแรก) |
| POST | `/auth/forgot-password` | public | ส่งลิงก์รีเซ็ตทางอีเมล |
| POST | `/auth/reset-password` | public | ตั้งรหัสใหม่ด้วย token |
| POST | `/auth/register` | public | สมัครสมาชิก สร้างบัญชีสถานะรออนุมัติ ไม่ออก cookie (ดูหมวด 9) |

`POST /auth/login` คืน 403 แยกตามสถานะบัญชี หลังจากตรวจรหัสผ่านถูกแล้วเท่านั้น

| code | เงื่อนไข |
|---|---|
| `ACCOUNT_PENDING` | ใบสมัครรอ ADMIN ตรวจสอบ |
| `ACCOUNT_REJECTED` | ใบสมัครไม่ได้รับการอนุมัติ |
| `ACCOUNT_DISABLED` | ADMIN ปิดการใช้งานบัญชี |

---

## 2. คำขอ (ฝั่งผู้ขอ)

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| GET | `/requests` | ทุกคน | รายการคำขอ กรองตาม `status`, `year`, `faculty_id`, `q` (ระบบกรองตาม role ให้อัตโนมัติ) |
| GET | `/requests/:id` | เจ้าของ/ผู้เกี่ยวข้อง | รายละเอียดคำขอ + ไฟล์แนบ + approvals |
| POST | `/requests` | RESEARCHER | สร้างคำขอ (สถานะ DRAFT) |
| PUT | `/requests/:id` | เจ้าของ | แก้ไขได้เฉพาะสถานะ DRAFT หรือ RETURNED |
| POST | `/requests/:id/submit` | เจ้าของ | ส่งคำขอ ผ่าน validation แล้วเปลี่ยนเป็น FACULTY_REVIEW |
| POST | `/requests/:id/resubmit` | เจ้าของ | ส่งกลับหลังถูกตีกลับ กลับเข้าขั้นที่ตีกลับ ไม่เริ่มใหม่ |
| DELETE | `/requests/:id` | เจ้าของ | ยกเลิก ทำได้ก่อนถึงขั้นอนุมัติเท่านั้น |
| GET | `/requests/:id/timeline` | ผู้เกี่ยวข้อง | log การเปลี่ยนสถานะทั้งหมดสำหรับหน้าติดตาม |
| GET | `/requests/:id/document` | ผู้เกี่ยวข้อง | ออก PDF บันทึกข้อความ CPRU-RDI-F011 |
| POST | `/requests/preview-amount` | RESEARCHER | คำนวณยอดเงินจาก `journal_tier_id` + `from_conference` |
| GET | `/requests/my-quota` | RESEARCHER | เบิกไปแล้วกี่เรื่อง เหลือสิทธิ์อีกกี่เรื่องในปีปฏิทิน |

---

## 3. ไฟล์แนบ

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| POST | `/requests/:id/attachments` | เจ้าของ | อัปโหลด PDF ระบุ `doc_type` (multipart) |
| GET | `/attachments/:id/download` | ผู้เกี่ยวข้อง | ดาวน์โหลดผ่าน controller ที่เช็คสิทธิ์ก่อน |
| DELETE | `/attachments/:id` | เจ้าของ | ลบได้เฉพาะสถานะ DRAFT หรือ RETURNED |
| PATCH | `/attachments/:id/verify` | RDI_OFFICER | ติ๊กว่าไฟล์นี้ตรวจผ่าน |

---

## 4. การพิจารณาและอนุมัติ

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| GET | `/approvals/inbox` | ผู้ตรวจทุกระดับ | คิวงานของฉัน เรียงตามวันที่ค้าง |
| GET | `/approvals/inbox/count` | ผู้ตรวจทุกระดับ | badge จำนวนงานค้าง |
| POST | `/requests/:id/approve` | ตาม step ปัจจุบัน | เห็นชอบ ส่งต่อขั้นถัดไป |
| POST | `/requests/:id/return` | ตาม step ปัจจุบัน | ตีกลับ ต้องส่ง `missing_documents` |
| POST | `/requests/:id/reject` | APPROVER | ไม่อนุมัติ ต้องส่ง `comment` |
| POST | `/requests/:id/final-approve` | APPROVER | อนุมัติพร้อม `amount_approved` และจองงบ |
| POST | `/requests/:id/to-committee` | RDI_OFFICER | ส่งเข้าคณะกรรมการกรณีไม่เข้าหลักเกณฑ์ |
| PATCH | `/requests/:id/qa-year` | FACULTY_QA | บันทึกปีที่ใช้เป็นตัวชี้วัดประกันคุณภาพ |

กฎที่ต้องบังคับใน middleware ทุก endpoint ในหมวดนี้

1. ผู้ใช้ต้องมี role ตรงกับ `step_code` ของขั้นปัจจุบัน
2. `request.status` ต้องตรงกับขั้นที่กำลังจะทำ
3. `request.user_id !== req.user.id` ห้ามอนุมัติคำขอของตัวเอง
4. สำหรับ FACULTY_QA และ DEAN ต้องอยู่คณะเดียวกับ `request.faculty_id`

---

## 5. การเงินและงบประมาณ

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| GET | `/budget/summary` | FINANCE, ADMIN, APPROVER | วงเงินตั้งต้น, ยอดจอง, ยอดจ่ายจริง, คงเหลือ |
| GET | `/budget/years` | FINANCE, ADMIN | รายการปีงบประมาณ |
| POST | `/budget/years` | ADMIN | ตั้งวงเงินปีใหม่ |
| PUT | `/budget/years/:id` | ADMIN | แก้ไขวงเงิน |
| GET | `/payments` | FINANCE | รายการรอเบิกจ่ายและจ่ายแล้ว |
| POST | `/requests/:id/pay` | FINANCE | บันทึกจ่ายจริง ใส่ `voucher_no`, `paid_at` |
| POST | `/payments/:id/refund` | FINANCE, ADMIN | บันทึกเรียกเงินคืนพร้อมเหตุผล |

`/budget/summary` ต้องคืนสามยอดแยกกัน ไม่ใช่ยอดเดียว

```json
{
  "year": 2569,
  "total": 1500000.00,
  "reserved": 240000.00,
  "paid": 615000.00,
  "available": 645000.00
}
```

`reserved` คือผลรวม `amount_approved` ของคำขอสถานะ APPROVED ที่ยังไม่จ่าย
`available` = total − reserved − paid

---

## 6. ข้อมูลพื้นฐาน

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| GET | `/journal-tiers` | ทุกคน | อัตราค่าตอบแทนที่ `is_active` สำหรับ dropdown |
| POST | `/journal-tiers` | ADMIN | เพิ่มอัตราใหม่เมื่อมีประกาศใหม่ |
| PUT | `/journal-tiers/:id` | ADMIN | แก้ไข / ปิดใช้งาน (เช่น ACI) |
| GET | `/faculties` | public | รายการหน่วยงาน/สังกัดที่ `is_active` (หน้าสมัครสมาชิกใช้ก่อนล็อกอิน) |
| GET | `/faculties/:id/departments` | ทุกคนที่ล็อกอิน | สาขาในหน่วยงาน (หน้าสมัครสมาชิกไม่ใช้ เพราะพิมพ์สาขาเอง) |
| GET | `/users` | ADMIN | รายการผู้ใช้ ค้นหาและแบ่งหน้า |
| POST | `/users` | ADMIN | สร้างบัญชี ระบบส่งรหัสชั่วคราวทางอีเมล |
| PUT | `/users/:id` | ADMIN | แก้ไขข้อมูลและบทบาท |
| PATCH | `/users/:id/status` | ADMIN | เปิด/ปิดการใช้งานบัญชี (ใช้กับใบสมัครที่ยังไม่อนุมัติไม่ได้ คืน `REGISTRATION_NOT_APPROVED`) |
| GET | `/users/reviewer-coverage` | ADMIN | หน่วยงานที่ยังไม่มี `FACULTY_QA` หรือ `DEAN` (คำขอจากหน่วยงานนั้นจะค้าง) |

`POST /users` และ `PUT /users/:id` รับ `facultyId` และ `staffTrack` (`ACADEMIC` / `SUPPORT`) เพิ่ม
ถ้าส่ง `departmentId` โดยไม่ส่ง `facultyId` ระบบใช้หน่วยงานของสาขานั้น ส่งทั้งคู่แต่ไม่ตรงกันคืน `DEPARTMENT_FACULTY_MISMATCH`

---

## 7. รายงาน

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| GET | `/reports/by-faculty` | ADMIN, FINANCE, APPROVER | สรุปจำนวนเรื่องและยอดเงินรายคณะ |
| GET | `/reports/by-tier` | ADMIN, FINANCE | สรุปตามฐานข้อมูลวารสาร |
| GET | `/reports/processing-time` | ADMIN | เวลาเฉลี่ยที่แต่ละขั้นใช้ ใช้หาคอขวด |
| GET | `/reports/qa-indicator` | FACULTY_QA, ADMIN | จำนวนบทความตีพิมพ์รายปีสำหรับงานประกันคุณภาพ |
| GET | `/reports/export` | ADMIN, FINANCE | ส่งออก Excel ตามเงื่อนไขที่กรอง |

---

## 8. ระบบภายใน

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| POST | `/cron/reminders` | secret header | cPanel cron เรียกวันละครั้ง เตือนงานค้างเกิน 5 วันทำการ |
| GET | `/health` | public | ตรวจว่า Passenger ยัง serve อยู่ |

endpoint กลุ่ม cron ต้องตรวจ header ลับ เช่น `X-Cron-Token` เทียบกับ env ห้ามเปิดสาธารณะ

---

## 9. สมัครสมาชิก (CLAUDE.md ข้อ 13)

| Method | Endpoint | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| POST | `/auth/register` | public | ส่งใบสมัคร คืน `201 { "status": "PENDING" }` จำกัด 5 ครั้งต่อชั่วโมงต่อ IP |
| GET | `/registrations` | ADMIN | ใบสมัคร กรอง `status` = `PENDING` (ค่าเริ่มต้น) / `APPROVED` / `REJECTED` เรียงเก่าสุดก่อน |
| GET | `/registrations/count` | ADMIN | จำนวนใบสมัครที่รออยู่ สำหรับ badge บนเมนู |
| POST | `/registrations/:id/approve` | ADMIN | อนุมัติ เปิดบัญชี และให้ `RESEARCHER` เสมอ body `{ "facultyId": "2", "roles": [{ "roleCode": "DEAN" }] }` ทั้งสองค่าไม่บังคับ (`facultyId` ใช้แก้หน่วยงานที่ผู้สมัครเลือกมา) |
| POST | `/registrations/:id/reject` | ADMIN | ไม่อนุมัติ body `{ "reason": "..." }` อย่างน้อย 5 ตัวอักษร ระบบส่งเหตุผลให้ผู้สมัครทางอีเมล |

body ของ `POST /auth/register`

```json
{
  "facultyId": "2",
  "staffTrack": "ACADEMIC",
  "departmentName": "วิทยาการคอมพิวเตอร์",
  "firstName": "สมหญิง",
  "lastName": "ใจงาม",
  "phone": "081-234-5678",
  "email": "somying@cpru.ac.th",
  "password": "Abcd1234",
  "confirmPassword": "Abcd1234"
}
```

- body ถูกตรวจแบบ strict ส่ง key อื่นมา (เช่น `roles`, `isActive`) คืน 422 ทันที ผู้สมัครกำหนดบทบาทเองไม่ได้
- `FACULTY_QA` และ `DEAN` ที่ส่งมาตอนอนุมัติโดยไม่ระบุ `facultyId` จะผูกกับหน่วยงานของผู้สมัครอัตโนมัติ
- ใบสมัครที่เคยถูกปฏิเสธ สมัครใหม่ด้วยอีเมลเดิมได้ ระบบนำแถวเดิมกลับมาเป็น `PENDING`

| HTTP | code | เงื่อนไข |
|---|---|---|
| 422 | `VALIDATION_ERROR` | ฟิลด์ไม่ผ่านการตรวจ พร้อม `details` รายฟิลด์ |
| 422 | `INVALID_FACULTY` | หน่วยงานไม่มีอยู่หรือถูกปิดใช้งาน |
| 409 | `EMAIL_ALREADY_REGISTERED` | อีเมลนี้สมัครไว้แล้วและยัง `PENDING` หรือใช้งานอยู่ |
| 422 | `REGISTRATION_NOT_PENDING` | อนุมัติหรือปฏิเสธใบสมัครที่พิจารณาไปแล้ว |
| 429 | `TOO_MANY_REQUESTS` | สมัครถี่เกินกำหนดจาก IP เดียวกัน |

---

## Validation ตอน submit (ขั้นที่ 2 ของ workflow)

ทำงานใน `POST /requests/:id/submit` ถ้าข้อใดไม่ผ่านให้คืน 422 พร้อมรหัสข้อผิดพลาด

| รหัส | เงื่อนไข |
|---|---|
| `NOT_FIRST_AUTHOR` | ผู้ขอไม่ได้ติ๊กว่าเป็นผู้เขียนชื่อแรก |
| `QUOTA_EXCEEDED` | ปีปฏิทินนี้เบิกครบ 3 เรื่องแล้ว |
| `DUPLICATE_ARTICLE` | DOI หรือ ISSN+ชื่อเรื่อง ซ้ำกับคำขอที่อนุมัติหรือจ่ายแล้ว |
| `PUBLISH_YEAR_MISMATCH` | `published_at` ไม่อยู่ในปีปฏิทินที่ยื่นขอ |
| `BLACKLISTED_JOURNAL` | วารสารติดรายชื่อ Hijack Journal หรือ Beall's List |
| `ATTACHMENT_MISSING` | ขาดไฟล์ประเภทใดประเภทหนึ่งใน 3 ประเภทบังคับ |
| `AMOUNT_MISMATCH` | ยอดที่ขอไม่ตรงกับอัตราใน `journal_tiers` |
| `CERTIFICATION_INCOMPLETE` | ติ๊กคำรับรองไม่ครบ 3 ข้อ |
| `NO_ACTIVE_BUDGET_YEAR` | ยังไม่ได้ตั้งวงเงินปีงบประมาณปัจจุบัน |

---

## หมายเหตุการทำงานแบบ transaction

สองจุดนี้ต้องครอบด้วย `prisma.$transaction` เสมอ

1. **final-approve** — เขียน `request_approvals`, อัปเดต `requests.status` และ `amount_approved`, เขียน `request_status_logs` และเช็คซ้ำว่ายอดคงเหลือพอ ถ้าไม่พอให้ rollback ทั้งชุด
2. **pay** — สร้างแถวใน `payments`, เปลี่ยนสถานะเป็น PAID, เขียน log

การแจ้งเตือนให้ยิงหลัง transaction commit สำเร็จเท่านั้น ไม่งั้นจะมีเคสส่งเมลแจ้งอนุมัติแล้วแต่ข้อมูล rollback
