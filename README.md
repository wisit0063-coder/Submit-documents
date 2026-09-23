# ระบบเบิกจ่ายค่าตอบแทนการตีพิมพ์บทความผลงานทางวิชาการ

มหาวิทยาลัยราชภัฏชัยภูมิ (CPRU Publishing Fee Reimbursement System)

อ้างอิงประกาศมหาวิทยาลัยราชภัฏชัยภูมิ เลขที่ 2131/2566 และแบบฟอร์ม CPRU-RDI-F011

---

## 1. โครงสร้างโปรเจกต์

```
college/
├─ CLAUDE.md              บริบทโปรเจกต์ (แหล่งความจริงของกติกา)
├─ api-endpoints.md       สัญญา API
├─ files/schema.prisma    schema ต้นฉบับ
├─ docker-compose.yml     ทั้งระบบ: db + api + web + cron (production)
├─ docker-compose.dev.yml ส่วนเสริมสำหรับพัฒนา: hot reload และเปิดพอร์ต db
├─ .env.example           ตัวแปรของ docker compose
├─ docker/cron/           container ที่ยิง POST /api/cron/reminders วันละครั้ง
├─ api/                   Backend: Express + TypeScript + Prisma
│  ├─ Dockerfile          stage: dev / build / fonts / runtime
│  ├─ docker/             entrypoint ของ container (migrate แล้วค่อยเริ่มแอป)
│  ├─ app.js              entry ของแอป (ใช้ทั้งใน Docker และ Passenger)
│  ├─ prisma/
│  │  ├─ schema.prisma
│  │  ├─ migrations/      SQL สร้างตารางทั้ง 12 ตาราง
│  │  └─ seed.ts          ข้อมูลตั้งต้น: บทบาท คณะ อัตรา วงเงิน บัญชีตัวอย่าง
│  ├─ scripts/fetch-fonts.mjs  ดาวน์โหลดฟอนต์ Sarabun
│  ├─ assets/fonts/       ฟอนต์ Sarabun สำหรับ PDF
│  └─ src/
│     ├─ config/          env, prisma client, workflow, รายชื่อวารสารต้องห้าม
│     ├─ middleware/      auth, validate, upload, error handler
│     ├─ routes/          นิยาม endpoint ทั้งหมด
│     ├─ controllers/     รับ/ส่ง HTTP เท่านั้น ไม่มี business rule
│     ├─ services/        business rule ทั้งหมดอยู่ที่นี่
│     ├─ notifications/   ชั้นแจ้งเตือนแบบสลับ channel ได้
│     └─ validators/      Zod schema
└─ web/                   Frontend: React + Vite + TypeScript + Tailwind
   ├─ Dockerfile          stage: dev / build / runtime (nginx)
   ├─ nginx/              เสิร์ฟ SPA และ proxy /api ไปที่ api
   ├─ public/.htaccess    SPA routing สำหรับ Apache (ใช้เฉพาะ cPanel)
   └─ src/
      ├─ components/ui/   ปุ่ม ฟอร์ม ตาราง modal toast
      ├─ layouts/         โครงหน้าและเมนูตามบทบาท
      ├─ lib/             api client, auth context, format, chart tokens
      └─ pages/           หน้าจอทั้งหมด
```

---

## 2. เปิดโปรเจกต์ด้วย Docker

ต้องมี Docker Engine 24 ขึ้นไป และ Docker Compose v2.24 ขึ้นไป (ไฟล์ dev ใช้ `!override`)
ไม่ต้องติดตั้ง Node.js หรือ PostgreSQL บนเครื่อง

```
browser ──> web (nginx :8080) ──/api──> api (node :3000) ──> db (postgres 16)
                                             ^
                                  cron ──────┘  POST /api/cron/reminders วันละครั้ง
```

เบราว์เซอร์เห็นทุกอย่างเป็นโดเมนเดียว (nginx proxy `/api`) cookie แบบ httpOnly จึงใช้ได้โดยไม่ต้องตั้ง CORS

### 2.1 เปิดใช้งานทันที (ข้อมูลทดสอบ)

ไม่ต้องสร้างไฟล์ `.env` ทุกตัวแปรใน compose มีค่าทดสอบตั้งไว้แล้ว และระบบ seed ข้อมูลตัวอย่างให้เองตอนเริ่ม

```bash
docker compose up -d --build
```

เปิด http://localhost:8080 แล้วเข้าสู่ระบบด้วย `admin` / `Cpru@2569` (บัญชีอื่นดูในตารางด้านล่าง)

| ค่าทดสอบ | ค่า |
|---|---|
| หน้าเว็บ | http://localhost:8080 |
| `DATABASE_URL` (ภายใน container) | `postgresql://cpru:cpruTest2569@db:5432/cpru_pubfee` |
| `JWT_SECRET` | `test-jwt-secret-local-docker-only` |
| `CRON_TOKEN` | `test-cron-token-local-docker-only` |
| อีเมล | ไม่ส่งจริง พิมพ์ลง log ของ api (`MAIL_DRIVER=log`) |

**ค่าเหล่านี้เปิดเผยอยู่ใน repository ห้ามใช้กับระบบจริง** ก่อน deploy ให้ทำตามหัวข้อ 3.1
ถ้าต้องการเปลี่ยนค่าบางตัวบนเครื่องพัฒนา ให้ `cp .env.example .env` แล้วแก้เฉพาะค่าที่ต้องการ
(รหัสผ่านฐานข้อมูลควรเป็นตัวอักษรกับตัวเลขเท่านั้น เพราะถูกนำไปต่อเป็น `DATABASE_URL`)

ถ้าเคยเปิดระบบด้วยรหัสผ่านฐานข้อมูลชุดอื่นมาก่อน ต้องล้าง volume เดิมหนึ่งครั้ง เพราะ Postgres ตั้งรหัสผ่านเฉพาะตอนสร้างฐานข้อมูลครั้งแรก
`docker compose down -v` (คำสั่งนี้ลบข้อมูลทดสอบและไฟล์แนบทั้งหมด)

### 2.2 โหมดพัฒนา (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| บริการ | ที่อยู่ |
|---|---|
| หน้าเว็บ (Vite) | http://localhost:5173 |
| API | http://localhost:3000/api/health |
| PostgreSQL | localhost:5432 (ใช้ `POSTGRES_USER` / `POSTGRES_PASSWORD`) |

- แก้โค้ดใน `api/src` หรือ `web/src` แล้วระบบ reload เอง (ใช้ polling เพราะ Docker Desktop บน Windows ไม่ส่ง file event จาก bind mount)
- ครั้งแรกที่เริ่ม ระบบรัน migration และ seed ข้อมูลตั้งต้นให้อัตโนมัติ
- `node_modules` อยู่ใน container ไม่ใช้ของเครื่อง หลังแก้ `package.json` ให้รัน
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build --renew-anon-volumes`
- โหมดพัฒนาปิด cron ไว้ ถ้าต้องการทดสอบให้เพิ่ม `--profile cron`

### 2.3 โหมด production บนเครื่อง

```bash
docker compose up -d --build
```

เปิด http://localhost:8080 ใช้ image แบบเดียวกับที่จะ deploy จริง

### 2.4 คำสั่งที่ใช้บ่อย

```bash
docker compose ps                                  # สถานะและ health ของทุกบริการ
docker compose logs -f api                         # log ของ API
docker compose exec api node dist/prisma/seed.js   # seed ซ้ำ (ปลอดภัย ไม่สร้างบัญชีตัวอย่างซ้ำ)
docker compose exec cron reminders.sh              # สั่งส่งเตือนงานค้างทันที
docker compose down                                # หยุดระบบ ข้อมูลยังอยู่
```

`docker compose down -v` จะ **ลบฐานข้อมูลและไฟล์แนบทั้งหมด** ใช้เฉพาะเมื่อต้องการล้างเครื่องพัฒนาเท่านั้น

### 2.5 ติดตั้งแบบไม่ใช้ Docker

ต้องมี Node.js 18 ขึ้นไป และ PostgreSQL 14 ขึ้นไป (หรือโปรเจกต์ Supabase)

```bash
cd api
npm install
cp .env.example .env          # แก้ DATABASE_URL, DIRECT_URL, JWT_SECRET, CRON_TOKEN
npx prisma migrate deploy
npm run seed
npm run fonts                 # ดาวน์โหลดฟอนต์ Sarabun สำหรับ PDF
npm run dev                   # http://localhost:3000

cd ../web
npm install
npm run dev                   # http://localhost:5173 (proxy /api ไปที่ :3000)
```

### บัญชีตัวอย่างจาก seed

รหัสผ่านเริ่มต้นทุกบัญชีคือ `Cpru@2569` และระบบบังคับเปลี่ยนรหัสในการเข้าใช้ครั้งแรก

| ชื่อผู้ใช้ | อีเมล | บทบาท | หน่วยงาน |
|---|---|---|---|
| `researcher` | researcher@cpru.ac.th | ผู้ขอรับค่าตอบแทน | คณะศิลปศาสตร์และวิทยาศาสตร์ |
| `facultyqa` | qa.sci@cpru.ac.th | ประกันคุณภาพคณะ + ผู้ขอ | คณะศิลปศาสตร์และวิทยาศาสตร์ |
| `dean` | dean.sci@cpru.ac.th | คณบดี + ผู้ขอ (ตัวอย่างการถือหลายบทบาท) | คณะศิลปศาสตร์และวิทยาศาสตร์ |
| `deanedu` | dean.edu@cpru.ac.th | คณบดี + ผู้ขอ | คณะครุศาสตร์และการพัฒนามนุษย์ |
| `rdi` | rdi.officer@cpru.ac.th | เจ้าหน้าที่สถาบันวิจัยและพัฒนา | สำนักงานอธิการบดี |
| `academic` | academic.office@cpru.ac.th | สำนักส่งเสริมวิชาการฯ | สำนักส่งเสริมวิชาการและการเรียนรู้ตลอดชีวิต |
| `approver` | vp.research@cpru.ac.th | รองอธิการบดีฝ่ายวิจัยฯ | สำนักงานอธิการบดี |
| `finance` | finance@cpru.ac.th | งานการเงิน | สำนักงานอธิการบดี |
| `admin` | admin@cpru.ac.th | ผู้ดูแลระบบ + การเงิน | สำนักงานอธิการบดี |

มีใบสมัครตัวอย่างที่รออนุมัติ 1 ใบ (`applicant@cpru.ac.th` คณะพยาบาลศาสตร์) ให้ล็อกอินเป็น `admin` แล้วเปิดเมนู **ใบสมัครสมาชิก** เพื่อทดลองอนุมัติ
ก่อนอนุมัติ ถ้าล็อกอินด้วยบัญชีนี้จะได้ข้อความ "บัญชีอยู่ระหว่างรอผู้ดูแลระบบตรวจสอบ"

ข้อมูลตัวอย่างถูกสร้างเฉพาะตอนที่ตาราง `users` ยังว่าง การ seed ซ้ำบนฐานข้อมูลจริงจะไม่สร้างบัญชีเหล่านี้ขึ้นมาใหม่

### สมัครสมาชิก

บุคลากรสมัครเองได้ที่ `/register` (ลิงก์ "สมัครสมาชิก" อยู่ในหน้าเข้าสู่ระบบ) บัญชีที่สมัครต้องรอ ADMIN อนุมัติก่อนเข้าใช้
และได้บทบาทผู้ขอรับค่าตอบแทนเท่านั้น ตำแหน่งอื่น ADMIN กำหนดเอง รายละเอียดทั้งหมดอยู่ใน CLAUDE.md ข้อ 13

แต่ละหน่วยงานตอนนี้มีสาขาเดียวคือ "งานบริหารทั่วไป" จนกว่าจะได้รายชื่อสาขาวิชาจริง (CLAUDE.md ข้อ 13.9 Q5)
เพิ่มได้ที่ตัวแปร `DEPARTMENTS` ใน `api/prisma/seed.ts` แล้วรัน seed ซ้ำ

---

## 3. Deploy ด้วย Docker

### 3.1 เตรียมเซิร์ฟเวอร์

```bash
git clone <repo> cpru-pubfee && cd cpru-pubfee
cp .env.example .env
```

แก้ `.env` ก่อนเริ่มระบบครั้งแรก ถ้าไม่มีไฟล์นี้ ระบบจะใช้ค่าทดสอบที่เปิดเผยอยู่ใน repository ซึ่งไม่ปลอดภัยสำหรับใช้งานจริง

| ตัวแปร | ค่าที่ต้องตั้ง |
|---|---|
| `POSTGRES_PASSWORD` (หรือ `DATABASE_URL`+`DIRECT_URL` ของ Supabase) | รหัสผ่านสุ่ม ตัวอักษรและตัวเลขเท่านั้น |
| `JWT_SECRET`, `CRON_TOKEN` | สุ่มด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `APP_BASE_URL` | โดเมนจริง เช่น `https://research.cpru.ac.th` (ใช้สร้างลิงก์ในอีเมล) |
| `COOKIE_SECURE` | `true` เมื่อเปิดผ่าน HTTPS |
| `MAIL_DRIVER`, `SMTP_*` | `smtp` พร้อมค่าของ SMTP มหาวิทยาลัย |
| `RUN_SEED` | `true` เฉพาะครั้งแรก แล้วเปลี่ยนเป็น `false` |

ตรวจก่อนเริ่มว่าไม่มีค่าทดสอบหลงเหลือ คำสั่งนี้ต้องไม่แสดงผลลัพธ์ใดเลย

```bash
docker compose config | grep -E "test-jwt-secret|test-cron-token|cpruTest2569|cpruRootTest2569"
```

### 3.2 เริ่มระบบ

```bash
docker compose up -d --build
docker compose ps        # รอให้ db, api, web ขึ้นสถานะ healthy
```

ลำดับการเริ่มถูกกำหนดด้วย healthcheck: db พร้อม → api รัน `prisma migrate deploy` แล้วเริ่มแอป → web และ cron เริ่มหลัง api healthy

### 3.3 HTTPS

container `web` เปิดพอร์ต HTTP 8080 เพียงพอร์ตเดียว ให้วาง reverse proxy ที่ถือใบรับรองไว้ด้านหน้า
(เช่น nginx หรือ Caddy บนเครื่อง หรือ load balancer ของมหาวิทยาลัย) แล้ว proxy ทุก path มาที่ `http://127.0.0.1:8080`
ต้องส่งต่อ header `X-Forwarded-For` และ `X-Forwarded-Proto` และเมื่อเปิด HTTPS แล้วต้องตั้ง `COOKIE_SECURE=true`

### 3.4 อัปเดตเวอร์ชัน

```bash
git pull
docker compose up -d --build
```

migration ใหม่ถูกรันอัตโนมัติตอน api เริ่ม ไฟล์ compose นี้ออกแบบให้รัน api เพียง 1 instance
ห้ามใช้ `docker compose up --scale api=2` เพราะทุก instance จะรัน migration พร้อมกันตอนเริ่ม

### 3.5 ข้อมูลที่ต้องสำรอง

ข้อมูลถาวรอยู่ใน volume สองก้อน ต้องสำรองทั้งคู่ เพราะแถวใน `request_attachments` ชี้ไปที่ไฟล์ใน volume ไฟล์แนบ

```bash
# ฐานข้อมูล
docker compose exec db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backup-$(date +%F).sql
# บน Supabase ใช้ pg_dump กับ DIRECT_URL แทน (Supabase มี automatic backup ให้ด้วย แต่ระดับฟรีเก็บย้อนหลังจำกัด)

# ไฟล์แนบ
docker run --rm -v cpru-pubfee_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

### 3.6 ฟอนต์ PDF

ตอน build image ของ api ระบบดาวน์โหลดฟอนต์ Sarabun (SIL Open Font License) จาก repository google/fonts ให้อัตโนมัติ
ถ้าเซิร์ฟเวอร์ build ออกอินเทอร์เน็ตไม่ได้ ให้วางไฟล์ TTF ทั้ง 4 ไฟล์ใน `api/assets/fonts/` แล้วตั้ง `FETCH_FONTS=false`

---

## 4. Deploy ขึ้น cPanel + Passenger (ทางเลือก)

โค้ดยังรองรับ shared hosting ตามข้อจำกัดใน CLAUDE.md ข้อ 3 (entry `app.js`, ไม่ hardcode พอร์ต, ไม่มี timer ในแอป)

### 4.1 เตรียมไฟล์บนเครื่องพัฒนา

```bash
cd api  && npm run build     # tsc -> api/dist + prisma generate
cd ../web && npm run build   # vite -> web/dist
```

### 4.2 อัปโหลด

| ต้นทาง | ปลายทางบนโฮสต์ |
|---|---|
| `web/dist/*` | `/home/user/public_html/` |
| `api/` (ยกเว้น `node_modules`, `src`) | `/home/user/api/` |
| ไฟล์ฟอนต์ Sarabun 4 ไฟล์ | `/home/user/api/assets/fonts/` |
| สร้างโฟลเดอร์เปล่า | `/home/user/storage/uploads/` |

`public_html` ต้องมี `.htaccess` ที่มากับ `web/dist` เพื่อให้ React Router ทำงาน

### 4.3 ตั้งค่า Node.js App ใน cPanel

- Application root: `api`
- Application URL: `/api`
- Application startup file: `app.js`
- Node.js version: 18 ขึ้นไป
- กด **Run NPM Install** แล้วรัน `npx prisma migrate deploy` ใน terminal ของแอป

ตัวแปรสภาพแวดล้อมที่ต้องตั้ง (ดูรายการเต็มใน `api/.env.example`)

```
DATABASE_URL, JWT_SECRET, CRON_TOKEN, UPLOAD_DIR=/home/user/storage/uploads,
APP_BASE_URL, SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM, NODE_ENV=production
```

ห้ามตั้ง `PORT` เอง Passenger เป็นผู้กำหนดให้

### 4.4 ตั้ง cron job

ระบบไม่มี `setInterval` และไม่มี worker แยก process งานตามเวลาใช้ cPanel cron ยิงเข้า endpoint แทน

```
0 8 * * * curl -s -X POST -H "X-Cron-Token: <CRON_TOKEN>" https://<domain>/api/cron/reminders
```

เตือนเมื่อคำขอค้างเกิน 5 วันทำการ (ปรับได้ที่ `REMINDER_AFTER_BUSINESS_DAYS`)

---

## 5. กติกาสำคัญอยู่ที่ไฟล์ไหน

| กติกา | ไฟล์ |
|---|---|
| ลำดับขั้นการอนุมัติทั้งหมด | `api/src/config/workflow.ts` |
| กฎ 9 ข้อตอน submit (สิทธิ์ 3 เรื่อง, เบิกซ้ำ, ปีที่ตีพิมพ์, วารสารต้องห้าม, เอกสารครบ) | `api/src/services/validation.service.ts` |
| 4 การ์ดของทุก endpoint พิจารณา (role, status, ห้ามอนุมัติของตัวเอง, คณะเดียวกัน) | `api/src/services/approval.service.ts` → `assertCanActOnStep` |
| transaction ตอน final-approve และ pay | `approval.service.ts`, `payment.service.ts` |
| งบสามก้อน total / reserved / paid | `api/src/services/budget.service.ts` |
| ตีกลับแล้วกลับเข้าขั้นเดิม | `request.service.ts` → `resubmitRequest` (ใช้ `currentStep`) |
| ลำดับสิทธิ์ประจำปีเขียนตอนอนุมัติ | `approval.service.ts` → `finalApprove` (`sequenceInYear`) |
| ชั้นแจ้งเตือนแบบสลับ channel | `api/src/notifications/` |
| รายชื่อ Hijacked / Beall's List | `api/src/config/blacklisted-journals.json` (แก้ได้โดยไม่ต้องแก้โค้ด) |

---

## 6. เรื่องที่ต้องรู้ก่อนแก้โค้ด

**ฟอนต์ PDF** ถ้าไม่มีไฟล์ Sarabun ใน `api/assets/fonts/` endpoint ออก PDF จะคืน `FONT_NOT_INSTALLED`
เลือกให้ล้มเหลวชัดเจน เพราะถ้า fallback ไปใช้ Roboto ข้อความไทยจะหายทั้งหน้าโดยไม่มีใครรู้

**คำรับรองผู้เขียนชื่อแรก** `schema.prisma` เก็บคำรับรอง 3 ข้อตามแบบฟอร์ม แต่ไม่มีคอลัมน์สำหรับ First author
ระบบจึงรับค่านี้ตอนกดส่ง (`POST /requests/:id/submit` body `{ isFirstAuthor }`) และบันทึกการรับรองไว้ใน `request_status_logs`
ถ้าภายหลังต้องการเก็บเป็นหลักฐานถาวรในตาราง ให้เพิ่มคอลัมน์ `cert_is_first_author` แล้วแก้ `validateForSubmit` ให้อ่านจากคอลัมน์แทน

**เวลาและโซนเวลา** ทุกอย่างเก็บลงฐานข้อมูลเป็น UTC การคำนวณปีปฏิทิน ปีงบประมาณ และวันทำการ
ใช้ helper ใน `api/src/utils/datetime.ts` ที่บวก offset ของกรุงเทพเอง ไม่พึ่ง timezone ของเซิร์ฟเวอร์

**ไฟล์แนบ** ไม่เคย serve จาก static path ทุกการดาวน์โหลดผ่าน `GET /api/attachments/:id/download`
ที่ตรวจสิทธิ์ก่อน และตรวจซ้ำว่า path ที่จะอ่านอยู่ใต้ `UPLOAD_DIR` จริง

**ยอดจอง** ถูกตัดตั้งแต่วินาทีที่อนุมัติ ไม่ใช่ตอนโอนเงิน และมีการตรวจวงเงินซ้ำ *ภายใน* transaction ของ final-approve
ผู้อนุมัติสองคนที่กดพร้อมกันบนวงเงินก้อนสุดท้ายจึงผ่านได้เพียงคนเดียว

**LINE** ไม่มีโค้ด LINE Notify อยู่ในระบบ (ปิดบริการ 31 มีนาคม 2568) ถ้าจะเพิ่ม LINE Messaging API
ให้ implement interface `NotificationChannel` แล้วลงทะเบียนใน `notifications/dispatcher.ts` โดยไม่ต้องแตะโค้ดส่วนอื่น

---

## 7. สถานะการทดสอบ

`cd api && npm test` มีเทสต์ 37 ข้อ ครอบคลุมส่วนที่เป็น logic ล้วนและรันได้โดยไม่ต้องต่อฐานข้อมูล

- ลำดับขั้น workflow ทั้งเส้น รวมทั้งสถานะที่ห้ามมีใครกดพิจารณา และเงื่อนไขการยกเลิก
- การนับปีปฏิทิน ปีงบประมาณ และวันทำการ (รวมเคสข้ามปีที่เวลา UTC กับเวลากรุงเทพต่างวันกัน)
- การจับคู่รายชื่อวารสารต้องห้าม
- การออก PDF แบบฟอร์ม CPRU-RDI-F011 (ข้ามอัตโนมัติถ้ายังไม่ได้วางฟอนต์ Sarabun)
- แบบฟอร์มสมัครสมาชิก: ฟิลด์บังคับ รูปแบบเบอร์โทร กฎรหัสผ่าน การปฏิเสธ `roles` ที่ผู้สมัครแอบส่งมา และการจำกัดความถี่

เส้นทางที่ต้องใช้ฐานข้อมูลจริง (ยื่น/ตีกลับ/อนุมัติ/บันทึกจ่าย การตัดสิทธิ์ 3 เรื่องต่อปี การตรวจวงเงินใน transaction
และการสมัคร/อนุมัติ/ปฏิเสธบัญชี) ทดสอบด้วย `npm run test:e2e` ใน `api/` ซึ่งยิง HTTP จริงทั้งระบบ 152 ข้อ
ต้องเปิดสแต็ก Docker ไว้ ฐานข้อมูลที่ใช้คือ Postgres ใน `docker-compose.dev.yml` ที่ `localhost:5432`

---

## 8. คำสั่งที่ใช้บ่อย

```bash
# ตรวจ type ทั้งสองฝั่ง
cd api && npm run typecheck
cd web && npm run typecheck

# รันเทสต์ฝั่ง backend (ไม่ต้องต่อฐานข้อมูล)
cd api && npm test

# สร้าง migration หลังแก้ schema
cd api && npx prisma migrate dev --name <ชื่อ>

# ดูฐานข้อมูลผ่าน GUI
cd api && npx prisma studio
```
