/**
 * End-to-end probe for the CPRU publishing-fee system.
 *
 * Drives the real HTTP API of the running stack: sign-up, admin approval,
 * creating senior accounts, the full approval chain, several return paths,
 * payment, refunds and the entitlement rules.
 *
 * Everything it creates is tagged with the RUN id so cleanup can find it.
 */

import { execSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:8080/api';

/**
 * The sign-up and login limiters keep their counters in this process's memory
 * (CLAUDE.md ข้อ 3 rules out Redis), so restarting the container is the same as
 * waiting for the window to expire. The limits themselves are never weakened:
 * this only lets one script exercise more than an hour's worth of sign-ups.
 */
async function resetRateLimits(why) {
  const started = Date.now();
  execSync('docker restart cpru-pubfee-api-1', { stdio: 'ignore' });
  // Five minutes, not twenty seconds. Booting runs "migrate deploy" and the
  // seed before the port opens: ~5s against the local container, but measured
  // at 67s against Supabase, where every statement crosses an ocean.
  const deadline = started + 300_000;
  let waited = 0;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) {
        const secs = Math.round((Date.now() - started) / 1000);
        console.log(`  · รีเซ็ตตัวนับ rate limit (${why}) — api กลับมาใน ${secs} วินาที`);
        return;
      }
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 1000));
    waited += 1;
    // Silence for minutes looks like a hang; say what is going on.
    if (waited % 30 === 0) console.log(`      รอ api กลับมา ${waited} วินาที...`);
  }
  throw new Error('api ไม่กลับมาภายใน 5 นาทีหลังรีสตาร์ท');
}
const RUN = process.env.RUN_ID ?? String(Date.now()).slice(-6);
/**
 * The admin password is read from the environment. The seed's default stops
 * working the moment someone does what the first login demands and changes it,
 * and a real password does not belong in a script anyway.
 *
 *   E2E_ADMIN_PASSWORD='...' npm run test:e2e
 */
const ADMIN = {
  username: process.env.E2E_ADMIN_USER ?? 'admin',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'Cpru@2569',
};
const PW = 'Cpru2569test';

let pass = 0;
const failures = [];
let section = '';

function head(title) {
  section = title;
  console.log(`\n${'─'.repeat(70)}\n${title}\n${'─'.repeat(70)}`);
}

function check(desc, expected, actual, detail) {
  const ok = String(expected) === String(actual);
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${desc}  [${actual}]`);
  } else {
    failures.push({ section, desc, expected, actual, detail });
    console.log(`  FAIL  ${desc}  expected=${expected} got=${actual}${detail ? `  ${detail}` : ''}`);
  }
  return ok;
}

/**
 * A run takes half an hour against a hosted database, and anything that
 * recreates the nginx container in that window - `docker compose up -d` in
 * another terminal, Docker Desktop restarting - kills the whole run mid-way.
 *
 * Only connection-level failures are retried: those mean nginx refused or
 * dropped the connection before the API saw the request, so replaying it
 * cannot double-apply a POST. A response that arrives, even a 502, is returned
 * as-is and judged by the test.
 */
async function fetchResilient(url, options, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`      · เชื่อมต่อไม่ได้ (${error.cause?.code ?? error.message}) ลองใหม่ครั้งที่ ${attempt}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// --- HTTP with a cookie jar per actor -------------------------------------

class Actor {
  constructor(label) {
    this.label = label;
    this.cookie = null;
  }

  async call(method, path, { body, form, extraHeaders } = {}) {
    const headers = { ...(extraHeaders ?? {}) };
    if (this.cookie) headers.Cookie = this.cookie;
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetchResilient(`${BASE}${path}`, {
      method,
      headers,
      body: payload,
      redirect: 'manual',
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookie) {
      const pair = raw.split(';')[0];
      if (pair.startsWith('cpru_token=')) this.cookie = pair.endsWith('=') ? null : pair;
    }

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text.slice(0, 120);
    }
    return { status: res.status, json, code: json?.error?.code ?? null, msg: json?.error?.message ?? null };
  }

  get = (p, o) => this.call('GET', p, o);
  post = (p, body) => this.call('POST', p, { body });
  put = (p, body) => this.call('PUT', p, { body });
  patch = (p, body) => this.call('PATCH', p, { body });
  del = (p) => this.call('DELETE', p);

  async login(username, password) {
    const r = await this.call('POST', '/auth/login', { body: { username, password } });
    return r;
  }
}

// A small but structurally valid PDF, so the upload is a real file.
const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Size 4/Root 1 0 R>>\n%%EOF\n',
);

async function upload(actor, requestId, docType) {
  const form = new FormData();
  form.append('docType', docType);
  form.append('file', new Blob([PDF_BYTES], { type: 'application/pdf' }), `${docType}.pdf`);
  return actor.call('POST', `/requests/${requestId}/attachments`, { form });
}

// --- shared state ---------------------------------------------------------

const admin = new Actor('admin');
const created = { users: [], requests: [] };
let FACULTY = {};
let TIER = {};
let DEPT_LAS = null;

/**
 * `key` identifies the article. Two drafts sharing a key are the same article
 * and must collide on the duplicate rule; different keys must not, so the title
 * and DOI both carry it - the rule matches on DOI, or on ISSN plus title.
 */
const draftBody = (key = 'main', over = {}) => ({
  articleTitle: `E2E ${RUN}-${key} บทความทดสอบระบบเบิกค่าตอบแทนการตีพิมพ์`,
  journalName: 'Journal of Applied Testing Science',
  volume: '12',
  issue: '3',
  pages: '101-115',
  issn: '1234-5678',
  doi: `10.9999/e2e.${RUN}.${key}`,
  articleUrl: 'https://example.org/article',
  publishedAt: '2026-03-15',
  journalTierId: TIER.TCI_2,
  fromConference: false,
  departmentId: DEPT_LAS,
  certNotOnStudyLeave: true,
  certNotThesisPart: true,
  certNotDuplicate: true,
  ...over,
});

async function createSenior(label, { username, email, prefix, firstName, lastName, facultyId, roles }) {
  const r = await admin.post('/users', {
    username,
    email,
    prefix,
    firstName,
    lastName,
    academicPosition: label,
    facultyId,
    roles,
  });
  if (r.status !== 201) {
    check(`สร้าง ${label}`, 201, r.status, `${r.code} ${r.msg}`);
    return null;
  }
  created.users.push(r.json.id);
  const actor = new Actor(label);
  const login = await actor.login(username, r.json.tempPassword);
  const okPw = login.status === 200;
  check(`สร้าง ${label} แล้วล็อกอินด้วยรหัสที่ระบบคืนมา`, true, okPw);
  if (okPw) {
    check(`  ${label} ถูกบังคับเปลี่ยนรหัสครั้งแรก`, true, login.json.user.mustChangePassword === true);
    // The cookie survives a password change, so no second login here - the
    // login rate limiter is 20 per 15 minutes and this script has many actors.
    const chg = await actor.post('/auth/change-password', {
      currentPassword: r.json.tempPassword,
      newPassword: PW,
    });
    check(`  ${label} เปลี่ยนรหัสผ่านครั้งแรกได้`, 200, chg.status, chg.code);
  }
  actor.userId = r.json.id;
  actor.username = username;
  return actor;
}

/** Walks a request one step forward, returning the resulting status. */
async function step(actor, requestId, action, body) {
  const r = await actor.post(`/requests/${requestId}/${action}`, body ?? {});
  return r;
}

async function statusOf(actor, requestId) {
  const r = await actor.get(`/requests/${requestId}`);
  return r.json?.status ?? `ERR:${r.status}`;
}

// ==========================================================================

async function main() {
  console.log(`E2E run ${RUN} against ${BASE}\n`);

  // Start from a clean window, otherwise a previous run's counters leak in.
  await resetRateLimits('เริ่มรอบทดสอบ');

  const adminLogin = await admin.login(ADMIN.username, ADMIN.password);
  if (adminLogin.status !== 200) {
    console.log(`ล็อกอิน ${ADMIN.username} ไม่ได้ (HTTP ${adminLogin.status}) — หยุด`);
    console.log('ถ้าเปลี่ยนรหัส admin แล้ว ให้ส่งรหัสใหม่ทาง environment:');
    console.log("  E2E_ADMIN_PASSWORD='รหัสใหม่' npm run test:e2e");
    process.exit(1);
  }

  const faculties = await admin.get('/faculties');
  for (const f of faculties.json) FACULTY[f.code] = f.id;
  const tiers = await admin.get('/journal-tiers');
  for (const t of tiers.json) TIER[t.code] = t.id;
  const depts = await admin.get(`/faculties/${FACULTY.LAS}/departments`);
  DEPT_LAS = depts.json[0].id;

  await partRegistration();
  const staff = await partSeniorAccounts();
  await partLifecycle(staff);
  await partEntitlement(staff);
  await partUnitVisibility(staff);

  // ---- report ----
  console.log(`\n${'='.repeat(70)}`);
  console.log(`ผลรวม: ผ่าน ${pass} · ไม่ผ่าน ${failures.length}`);
  if (failures.length) {
    console.log('\nรายการที่ไม่ผ่าน:');
    for (const f of failures) {
      console.log(`  [${f.section}] ${f.desc}`);
      console.log(`      expected=${f.expected} got=${f.actual}${f.detail ? ` (${f.detail})` : ''}`);
    }
  }
  console.log(`${'='.repeat(70)}`);
  console.log(`\nRUN_ID=${RUN}`);
}

// --- PART 1: sign-up ------------------------------------------------------

let researcher = null;
let researcherEmail = '';

async function partRegistration() {
  head('ส่วนที่ 1 · หน้าสมัครสมาชิก');
  const anon = new Actor('anon');
  researcherEmail = `e2e.res.${RUN}@cpru.ac.th`;

  const good = {
    facultyId: FACULTY.LAS,
    staffTrack: 'ACADEMIC',
    departmentName: 'วิทยาการคอมพิวเตอร์',
    firstName: 'ทดสอบ',
    lastName: 'ผู้ขอเบิก',
    phone: '081-234-5678',
    email: researcherEmail,
    password: PW,
    confirmPassword: PW,
  };

  // --- validation, and the sign-up limiter itself (5 per hour per IP) ---
  const badPhone = await anon.post('/auth/register', { ...good, email: `x1.${RUN}@cpru.ac.th`, phone: '12345' });
  check('เบอร์โทรผิดรูปแบบ', 422, badPhone.status, badPhone.code);

  const badPw = await anon.post('/auth/register', {
    ...good, email: `x2.${RUN}@cpru.ac.th`, confirmPassword: 'ไม่ตรงกัน123',
  });
  check('รหัสผ่านสองช่องไม่ตรงกัน', 422, badPw.status, badPw.code);

  const inject = await anon.post('/auth/register', {
    ...good, email: `x3.${RUN}@cpru.ac.th`, roles: [{ roleCode: 'ADMIN' }], isActive: true,
  });
  check('ยัด roles/isActive มาทาง API', 422, inject.status, inject.code);

  const badFac = await anon.post('/auth/register', { ...good, email: `x4.${RUN}@cpru.ac.th`, facultyId: '99999' });
  check('เลือกหน่วยงานที่ไม่มีอยู่จริง', 422, badFac.status, badFac.code);

  const fifth = await anon.post('/auth/register', { ...good, email: `x5.${RUN}@cpru.ac.th`, phone: 'bad' });
  check('ครั้งที่ 5 ยังไม่โดนจำกัด', 422, fifth.status, fifth.code);

  const sixth = await anon.post('/auth/register', { ...good, email: `x6.${RUN}@cpru.ac.th` });
  check('ครั้งที่ 6 จาก IP เดิมภายใน 1 ชม.', 429, sixth.status);
  check('  ได้ code TOO_MANY_REQUESTS', 'TOO_MANY_REQUESTS', sixth.code);

  const spoof = await anon.call('POST', '/auth/register', {
    body: { ...good, email: `x7.${RUN}@cpru.ac.th` },
    extraHeaders: { 'X-Forwarded-For': '198.51.100.77, 203.0.113.5' },
  });
  check('ปลอม X-Forwarded-For เพื่อหนีการจำกัด', 429, spoof.status, spoof.code);

  await resetRateLimits('หมดโควตาสมัครจากการทดสอบด้านบน');

  // --- the real sign-ups ---
  check('สมัครด้วยข้อมูลถูกต้อง', 201, (await anon.post('/auth/register', good)).status);

  const dup = await anon.post('/auth/register', good);
  check('สมัครซ้ำอีเมลที่รออนุมัติอยู่', 409, dup.status, dup.code);

  const wrongPw = await anon.login(researcherEmail, 'ผิดแน่นอน999');
  check('ล็อกอินบัญชีที่รออนุมัติ ด้วยรหัสผิด → ไม่บอกว่ามีอีเมลนี้', 401, wrongPw.status, wrongPw.code);

  const pending = await anon.login(researcherEmail, PW);
  check('ล็อกอินบัญชีที่รออนุมัติ ด้วยรหัสถูก', 403, pending.status, pending.code);
  check('  ได้ code ACCOUNT_PENDING', 'ACCOUNT_PENDING', pending.code);

  // ---- rejection path ----
  const rejEmail = `e2e.rej.${RUN}@cpru.ac.th`;
  await anon.post('/auth/register', { ...good, email: rejEmail, firstName: 'ถูกปฏิเสธ' });
  const list = await admin.get('/registrations?status=PENDING');
  const rejRow = list.json.find((r) => r.email === rejEmail);
  created.users.push(rejRow.id);

  const shortReason = await admin.post(`/registrations/${rejRow.id}/reject`, { reason: 'สั้น' });
  check('ปฏิเสธโดยไม่ระบุเหตุผลอย่างน้อย 5 ตัว', 422, shortReason.status, shortReason.code);

  check('ADMIN ปฏิเสธใบสมัคร', 200,
    (await admin.post(`/registrations/${rejRow.id}/reject`, { reason: 'ไม่พบชื่อในทะเบียนบุคลากร' })).status);

  const rejLogin = await anon.login(rejEmail, PW);
  check('ล็อกอินบัญชีที่ถูกปฏิเสธ', 403, rejLogin.status);
  check('  ได้ code ACCOUNT_REJECTED', 'ACCOUNT_REJECTED', rejLogin.code);

  check('สมัครซ้ำด้วยอีเมลที่เคยถูกปฏิเสธ → ใช้แถวเดิมได้', 201,
    (await anon.post('/auth/register', { ...good, email: rejEmail, firstName: 'สมัครใหม่' })).status);

  const twice = await admin.post(`/registrations/${rejRow.id}/reject`, { reason: 'เหตุผลทดสอบซ้ำ' });
  check('ปฏิเสธใบที่พิจารณาไปแล้ว (หลังกลับเป็น PENDING จะทำได้)', 200, twice.status, twice.code);

  // ---- approval path ----
  const pendList = await admin.get('/registrations?status=PENDING');
  const row = pendList.json.find((r) => r.email === researcherEmail);
  created.users.push(row.id);

  const appr = await admin.post(`/registrations/${row.id}/approve`, {});
  check('ADMIN อนุมัติใบสมัคร', 200, appr.status, appr.code);

  researcher = new Actor('researcher');
  const ok = await researcher.login(researcherEmail, PW);
  check('ผู้สมัครล็อกอินได้หลังอนุมัติ', 200, ok.status);
  check('  ได้บทบาท RESEARCHER', 'RESEARCHER', ok.json?.user?.roles?.join(','));
  check('  ไม่ถูกบังคับเปลี่ยนรหัส (ตั้งเอง)', false, ok.json?.user?.mustChangePassword);
  researcher.userId = row.id;

  const reAppr = await admin.post(`/registrations/${row.id}/approve`, {});
  check('อนุมัติใบเดิมซ้ำ', 422, reAppr.status, reAppr.code);
}

// --- PART 2: senior accounts ---------------------------------------------

async function partSeniorAccounts() {
  head('ส่วนที่ 2 · สร้างบัญชีระดับสูง (รวมระดับ ผอ.)');

  const cov = await admin.get('/users/reviewer-coverage');
  const before = cov.json.length;
  console.log(`  หน่วยงานที่ยังขาดผู้ตรวจก่อนเริ่ม: ${before} หน่วยงาน`);

  const qa = await createSenior('เจ้าหน้าที่ประกันคุณภาพคณะ', {
    username: `e2e_qa_${RUN}`, email: `e2e.qa.${RUN}@cpru.ac.th`, prefix: 'นางสาว',
    firstName: 'ประกัน', lastName: 'คุณภาพ', facultyId: FACULTY.LAS,
    roles: [{ roleCode: 'FACULTY_QA', facultyId: FACULTY.LAS }],
  });

  const dean = await createSenior('คณบดี', {
    username: `e2e_dean_${RUN}`, email: `e2e.dean.${RUN}@cpru.ac.th`, prefix: 'รศ.ดร.',
    firstName: 'คณบดี', lastName: 'ทดสอบ', facultyId: FACULTY.LAS,
    roles: [{ roleCode: 'DEAN', facultyId: FACULTY.LAS }, { roleCode: 'RESEARCHER' }],
  });

  // Q6 design: the head of a non-faculty unit holds DEAN scoped to that unit.
  const dirOffice = await createSenior('ผู้อำนวยการสำนักงานอธิการบดี', {
    username: `e2e_dirpres_${RUN}`, email: `e2e.dirpres.${RUN}@cpru.ac.th`, prefix: 'นาย',
    firstName: 'ผู้อำนวยการ', lastName: 'สำนักงานอธิการบดี', facultyId: FACULTY.PRES,
    roles: [
      { roleCode: 'DEAN', facultyId: FACULTY.PRES },
      { roleCode: 'FACULTY_QA', facultyId: FACULTY.PRES },
    ],
  });

  const dirAcad = await createSenior('ผู้อำนวยการสำนักส่งเสริมวิชาการฯ', {
    username: `e2e_diracad_${RUN}`, email: `e2e.diracad.${RUN}@cpru.ac.th`, prefix: 'ผศ.ดร.',
    firstName: 'ผู้อำนวยการ', lastName: 'ส่งเสริมวิชาการ', facultyId: FACULTY.ACAD,
    roles: [{ roleCode: 'ACADEMIC_OFFICE' }],
  });

  const rdi = await createSenior('เจ้าหน้าที่สถาบันวิจัย', {
    username: `e2e_rdi_${RUN}`, email: `e2e.rdi.${RUN}@cpru.ac.th`, prefix: 'นาย',
    firstName: 'สถาบัน', lastName: 'วิจัย', facultyId: FACULTY.PRES,
    roles: [{ roleCode: 'RDI_OFFICER' }],
  });

  const approver = await createSenior('รองอธิการบดีฝ่ายวิจัย', {
    username: `e2e_appr_${RUN}`, email: `e2e.appr.${RUN}@cpru.ac.th`, prefix: 'รศ.ดร.',
    firstName: 'รองอธิการบดี', lastName: 'ฝ่ายวิจัย', facultyId: FACULTY.PRES,
    roles: [{ roleCode: 'APPROVER' }],
  });

  const finance = await createSenior('งานการเงิน', {
    username: `e2e_fin_${RUN}`, email: `e2e.fin.${RUN}@cpru.ac.th`, prefix: 'นาง',
    firstName: 'การเงิน', lastName: 'กองคลัง', facultyId: FACULTY.PRES,
    roles: [{ roleCode: 'FINANCE' }],
  });

  // Another faculty's QA, used to prove the faculty scope guard.
  const qaOther = await createSenior('ประกันคุณภาพคณะอื่น', {
    username: `e2e_qaedu_${RUN}`, email: `e2e.qaedu.${RUN}@cpru.ac.th`, prefix: 'นาย',
    firstName: 'ประกัน', lastName: 'คณะครุศาสตร์', facultyId: FACULTY.EDU,
    roles: [{ roleCode: 'FACULTY_QA', facultyId: FACULTY.EDU }],
  });

  const covAfter = await admin.get('/users/reviewer-coverage');
  const stillMissing = covAfter.json.map((r) => r.facultyName);
  console.log(`  หน่วยงานที่ยังขาดผู้ตรวจหลังสร้าง: ${stillMissing.length} (${stillMissing.join(', ') || 'ครบแล้ว'})`);
  check('LAS มีผู้ตรวจครบแล้ว', false, covAfter.json.some((r) => String(r.facultyId) === String(FACULTY.LAS)));
  check('สำนักงานอธิการบดีมีผู้ตรวจครบแล้ว (ผอ. ถือบทบาทคณบดี)', false,
    covAfter.json.some((r) => String(r.facultyId) === String(FACULTY.PRES)));

  const nonAdmin = await researcher.get('/users');
  check('ผู้ขอทั่วไปเรียกรายชื่อผู้ใช้', 403, nonAdmin.status);
  const nonAdminCreate = await researcher.post('/users', { username: 'x', email: 'x@x.com', firstName: 'a', lastName: 'b', roles: [{ roleCode: 'ADMIN' }] });
  check('ผู้ขอทั่วไปสร้างบัญชี ADMIN เอง', 403, nonAdminCreate.status);

  return { qa, dean, dirOffice, dirAcad, rdi, approver, finance, qaOther };
}

// --- PART 3-6: lifecycle --------------------------------------------------

async function partLifecycle(s) {
  head('ส่วนที่ 3 · ยื่นคำขอและด่านตรวจกฎ');

  const draft = await researcher.post('/requests', draftBody('main'));
  check('สร้างคำขอฉบับร่าง', 201, draft.status, `${draft.code} ${draft.msg}`);
  const id = draft.json.id;
  created.requests.push(id);

  const noFiles = await step(researcher, id, 'submit', { isFirstAuthor: true });
  check('ยื่นทั้งที่ยังไม่แนบเอกสาร', 422, noFiles.status);
  check('  ได้ code ATTACHMENT_MISSING', 'ATTACHMENT_MISSING', noFiles.code);

  const notFirst = await step(researcher, id, 'submit', { isFirstAuthor: false });
  check('ยื่นโดยไม่ใช่ผู้เขียนชื่อแรก', 422, notFirst.status);
  check('  ได้ code NOT_FIRST_AUTHOR', 'NOT_FIRST_AUTHOR', notFirst.code);

  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) {
    const up = await upload(researcher, id, t);
    check(`แนบเอกสาร ${t}`, 201, up.status, `${up.code} ${up.msg}`);
  }

  // rule checks on throwaway drafts
  const wrongYear = await researcher.post('/requests', draftBody('year', { publishedAt: '2024-05-01' }));
  created.requests.push(wrongYear.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, wrongYear.json.id, t);
  const wy = await step(researcher, wrongYear.json.id, 'submit', { isFirstAuthor: true });
  check('วันที่ตีพิมพ์คนละปีกับปีที่ยื่น', 'PUBLISH_YEAR_MISMATCH', wy.code, `HTTP ${wy.status}`);

  const blacklisted = await researcher.post('/requests', draftBody('black', { journalName: 'OMICS International Journal of Everything' }));
  created.requests.push(blacklisted.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, blacklisted.json.id, t);
  const bl = await step(researcher, blacklisted.json.id, 'submit', { isFirstAuthor: true });
  check('วารสารอยู่ในรายชื่อต้องห้าม', 'BLACKLISTED_JOURNAL', bl.code, `HTTP ${bl.status}`);

  const noCert = await researcher.post('/requests', draftBody('cert', { certNotThesisPart: false }));
  created.requests.push(noCert.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, noCert.json.id, t);
  const nc = await step(researcher, noCert.json.id, 'submit', { isFirstAuthor: true });
  check('ไม่ได้ติ๊กคำรับรองครบ 3 ข้อ', 'CERTIFICATION_INCOMPLETE', nc.code, `HTTP ${nc.status}`);

  const submitted = await step(researcher, id, 'submit', { isFirstAuthor: true });
  check('ยื่นคำขอสำเร็จ', 200, submitted.status, `${submitted.code} ${submitted.msg}`);
  check('  สถานะเข้าสู่ขั้นคณะ', 'FACULTY_REVIEW', await statusOf(researcher, id));

  // ---- returns ----
  head('ส่วนที่ 4 · การตีกลับหลายรูปแบบ');

  const shortReason = await step(s.qa, id, 'return', { missingDocuments: 'สั้น' });
  check('ตีกลับโดยไม่ระบุรายละเอียด', 422, shortReason.status, shortReason.code);

  check('ขั้นคณะตีกลับ', 200, (await step(s.qa, id, 'return', {
    missingDocuments: 'สำเนาบทความไม่ชัด กรุณาแนบใหม่',
  })).status);
  check('  สถานะเป็น RETURNED', 'RETURNED', await statusOf(researcher, id));

  const editWhileReturned = await researcher.put(`/requests/${id}`, { volume: '13' });
  check('ผู้ขอแก้ไขได้ตอนถูกตีกลับ', 200, editWhileReturned.status);

  check('ส่งกลับเข้าพิจารณา', 200, (await step(researcher, id, 'resubmit', { isFirstAuthor: true })).status);
  check('  กลับไปที่ขั้นที่ตีกลับ ไม่ใช่เริ่มใหม่', 'FACULTY_REVIEW', await statusOf(researcher, id));

  check('ขั้นคณะเห็นชอบ', 200, (await step(s.qa, id, 'approve', { comment: 'เอกสารครบถ้วน' })).status);
  check('  ส่งต่อคณบดี', 'DEAN_REVIEW', await statusOf(researcher, id));

  check('คณบดีตีกลับ', 200, (await step(s.dean, id, 'return', {
    missingDocuments: 'ขอหลักฐานฐานข้อมูลที่แสดงวันที่ตีพิมพ์',
  })).status);
  check('  สถานะเป็น RETURNED', 'RETURNED', await statusOf(researcher, id));
  check('ส่งกลับอีกครั้ง', 200, (await step(researcher, id, 'resubmit', { isFirstAuthor: true })).status);
  check('  กลับเข้าขั้นคณบดีโดยตรง (ไม่ย้อนไปขั้นคณะ)', 'DEAN_REVIEW', await statusOf(researcher, id));

  check('คณบดีเห็นชอบ', 200, (await step(s.dean, id, 'approve', {})).status);
  check('  ส่งต่อสถาบันวิจัย', 'RDI_REVIEW', await statusOf(researcher, id));

  check('สถาบันวิจัยตีกลับ', 200, (await step(s.rdi, id, 'return', {
    missingDocuments: 'ขอหนังสือตอบรับฉบับจริง',
  })).status);
  check('ส่งกลับครั้งที่สาม', 200, (await step(researcher, id, 'resubmit', { isFirstAuthor: true })).status);
  check('  กลับเข้าขั้นสถาบันวิจัยโดยตรง', 'RDI_REVIEW', await statusOf(researcher, id));

  // ---- guards ----
  head('ส่วนที่ 5 · ด่านป้องกัน (guard)');

  const selfApprove = await step(s.dean, id, 'approve', {});
  check('คนละขั้นกับบทบาทตัวเอง (คณบดีกดที่ขั้น RDI)', 403, selfApprove.status, selfApprove.code);

  const wrongFaculty = await step(s.qaOther, id, 'approve', {});
  check('ประกันคุณภาพคณะอื่นเข้ามาพิจารณา', 403, wrongFaculty.status, wrongFaculty.code);

  const researcherApprove = await step(researcher, id, 'approve', {});
  check('ผู้ขอกดอนุมัติคำขอตัวเอง', 403, researcherApprove.status, researcherApprove.code);

  const financeApprove = await step(s.finance, id, 'approve', {});
  check('การเงินกดอนุมัติในขั้นพิจารณา', 403, financeApprove.status, financeApprove.code);

  // committee detour
  check('สถาบันวิจัยส่งเข้าคณะกรรมการ', 200,
    (await step(s.rdi, id, 'to-committee', { comment: 'กรณีวารสารเปลี่ยนฐานข้อมูลกลางปี' })).status);
  check('  สถานะเป็น COMMITTEE_REVIEW', 'COMMITTEE_REVIEW', await statusOf(researcher, id));
  check('คณะกรรมการเห็นชอบ', 200, (await step(s.rdi, id, 'approve', { comment: 'เข้าเกณฑ์' })).status);
  check('  ส่งต่อสำนักส่งเสริมวิชาการฯ', 'ACADEMIC_OFFICE_REVIEW', await statusOf(researcher, id));

  check('ผอ.สำนักส่งเสริมวิชาการฯ ให้ความเห็น', 200, (await step(s.dirAcad, id, 'approve', {})).status);
  check('  เข้าสู่ขั้นรออนุมัติ', 'PENDING_APPROVAL', await statusOf(researcher, id));

  const cancelLate = await researcher.del(`/requests/${id}`);
  check('ผู้ขอยกเลิกหลังเข้าขั้นอนุมัติ', 422, cancelLate.status, cancelLate.code);

  const plainApprove = await step(s.approver, id, 'approve', {});
  check('ใช้ปุ่มเห็นชอบธรรมดาในขั้นอนุมัติ', 422, plainApprove.status);
  check('  ได้ code USE_FINAL_APPROVE', 'USE_FINAL_APPROVE', plainApprove.code);

  const tooMuch = await step(s.approver, id, 'final-approve', { amountApproved: 999999 });
  check('อนุมัติเงินเกินอัตราที่ขอ', 422, tooMuch.status);
  check('  ได้ code AMOUNT_ABOVE_REQUESTED', 'AMOUNT_ABOVE_REQUESTED', tooMuch.code);

  // ---- approval + payment ----
  head('ส่วนที่ 6 · อนุมัติ ตัดงบ และเบิกจ่าย');

  const budgetBefore = (await admin.get('/budget/summary')).json;
  const finalAppr = await step(s.approver, id, 'final-approve', { amountApproved: 2500, comment: 'อนุมัติบางส่วน' });
  check('รองอธิการบดีอนุมัติ 2,500 จากที่ขอ 3,000', 200, finalAppr.status, `${finalAppr.code} ${finalAppr.msg}`);

  const afterAppr = (await researcher.get(`/requests/${id}`)).json;
  check('  สถานะ APPROVED', 'APPROVED', afterAppr.status);
  check('  ยอดอนุมัติน้อยกว่ายอดที่ขอได้', 2500, afterAppr.amountApproved);
  check('  ได้ลำดับสิทธิ์ที่ 1 ของปี', 1, afterAppr.sequenceInYear);

  const budgetAfter = (await admin.get('/budget/summary')).json;
  check('  ยอดจองเพิ่มขึ้น 2,500', budgetBefore.reserved + 2500, budgetAfter.reserved);
  check('  ยอดคงเหลือลดลง 2,500', budgetBefore.available - 2500, budgetAfter.available);

  const payByResearcher = await step(researcher, id, 'pay', { voucherNo: 'X', paidAt: '2026-09-01' });
  check('ผู้ขอบันทึกจ่ายเงินเอง', 403, payByResearcher.status);

  const paid = await step(s.finance, id, 'pay', {
    voucherNo: `E2E-${RUN}`, paidAt: '2026-09-15', note: 'โอนผ่านบัญชีธนาคาร',
  });
  check('การเงินบันทึกจ่ายจริง', 200, paid.status, `${paid.code} ${paid.msg}`);
  check('  สถานะ PAID', 'PAID', await statusOf(researcher, id));

  const budgetPaid = (await admin.get('/budget/summary')).json;
  check('  ยอดจองลดลง ย้ายไปเป็นยอดจ่ายจริง', budgetBefore.reserved, budgetPaid.reserved);
  check('  ยอดจ่ายจริงเพิ่ม 2,500', budgetBefore.paid + 2500, budgetPaid.paid);

  const payTwice = await step(s.finance, id, 'pay', { voucherNo: 'DUP', paidAt: '2026-09-16' });
  check('บันทึกจ่ายซ้ำ', 422, payTwice.status, payTwice.code);

  // PDF and timeline
  const doc = await researcher.call('GET', `/requests/${id}/document`);
  check('ออกเอกสาร PDF (บันทึกข้อความ)', 200, doc.status);
  const tl = await researcher.get(`/requests/${id}/timeline`);
  console.log(`  จำนวนบรรทัดใน timeline: ${tl.json.length} (ทุกการเปลี่ยนสถานะถูกบันทึก)`);
  check('timeline มีบันทึกครบทุกขั้น', true, tl.json.length >= 12, `ได้ ${tl.json.length}`);

  s.paidRequestId = id;
}

// --- PART 7: entitlement, duplicates, refunds -----------------------------

async function partEntitlement(s) {
  head('ส่วนที่ 7 · สิทธิ์ 3 เรื่อง/ปี · บทความซ้ำ · เรียกเงินคืน');

  // duplicate against a settled claim
  const dupSettled = await researcher.post('/requests', draftBody('main'));
  created.requests.push(dupSettled.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, dupSettled.json.id, t);
  const dupRes = await step(researcher, dupSettled.json.id, 'submit', { isFirstAuthor: true });
  check('ยื่นบทความ DOI เดียวกับที่จ่ายเงินไปแล้ว', 'DUPLICATE_ARTICLE', dupRes.code, `HTTP ${dupRes.status}`);

  // walk two more requests to APPROVED so the year is used up
  async function fullApprove(doiSuffix, amount) {
    const r = await researcher.post('/requests', draftBody(doiSuffix));
    const rid = r.json.id;
    created.requests.push(rid);
    for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, rid, t);
    const sub = await step(researcher, rid, 'submit', { isFirstAuthor: true });
    if (sub.status !== 200) return { rid, error: `submit ${sub.status} ${sub.code}` };
    await step(s.qa, rid, 'approve', {});
    await step(s.dean, rid, 'approve', {});
    await step(s.rdi, rid, 'approve', {});
    await step(s.dirAcad, rid, 'approve', {});
    const fa = await step(s.approver, rid, 'final-approve', { amountApproved: amount });
    return { rid, final: fa };
  }

  // in-flight duplicate: file the same DOI twice before either settles
  const a = await researcher.post('/requests', draftBody('inflight'));
  created.requests.push(a.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, a.json.id, t);
  check('ยื่นใบแรกของบทความใหม่', 200, (await step(researcher, a.json.id, 'submit', { isFirstAuthor: true })).status);

  const b = await researcher.post('/requests', draftBody('inflight'));
  created.requests.push(b.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, b.json.id, t);
  const bRes = await step(researcher, b.json.id, 'submit', { isFirstAuthor: true });
  check('ยื่นบทความเดียวกันซ้ำขณะใบแรกกำลังพิจารณา', 'DUPLICATE_ARTICLE', bRes.code, `HTTP ${bRes.status}`);
  console.log(`      ข้อความ: ${bRes.msg}`);

  // push the in-flight one through, so the researcher now has 2 approved
  await step(s.qa, a.json.id, 'approve', {});
  await step(s.dean, a.json.id, 'approve', {});
  await step(s.rdi, a.json.id, 'approve', {});
  await step(s.dirAcad, a.json.id, 'approve', {});
  const secondAppr = await step(s.approver, a.json.id, 'final-approve', { amountApproved: 3000 });
  check('อนุมัติเรื่องที่ 2 ของปี', 200, secondAppr.status, `${secondAppr.code} ${secondAppr.msg}`);
  check('  ได้ลำดับสิทธิ์ที่ 2', 2, (await researcher.get(`/requests/${a.json.id}`)).json.sequenceInYear);

  const third = await fullApprove('three', 3000);
  check('อนุมัติเรื่องที่ 3 ของปี', 200, third.final?.status, third.error ?? `${third.final?.code}`);

  const quota = (await researcher.get('/auth/me')).json.quota;
  console.log(`  สิทธิ์ปี ${quota.calendarYear}: ใช้ไป ${quota.used} เหลือ ${quota.remaining}`);
  check('ใช้สิทธิ์ครบ 3 เรื่อง', 3, quota.used);

  // fourth must be refused at submit
  const fourth = await researcher.post('/requests', draftBody('four'));
  created.requests.push(fourth.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, fourth.json.id, t);
  const fourthRes = await step(researcher, fourth.json.id, 'submit', { isFirstAuthor: true });
  check('ยื่นเรื่องที่ 4 ของปีเดียวกัน', 'QUOTA_EXCEEDED', fourthRes.code, `HTTP ${fourthRes.status}`);

  // ---- refunds ----
  const payments = await admin.get('/payments?status=paid');
  const paidRow = payments.json.paid.find((p) => String(p.request.id) === String(s.paidRequestId));

  const overRefund = await admin.post(`/payments/${paidRow.id}/refund`, {
    refundAmount: 99999, refundReason: 'ทดสอบเรียกคืนเกินยอดที่จ่าย',
  });
  check('เรียกเงินคืนเกินยอดที่จ่ายไป', 422, overRefund.status, overRefund.code);

  const partial = await admin.post(`/payments/${paidRow.id}/refund`, {
    refundAmount: 500, refundReason: 'จ่ายเกินอัตรา เรียกคืนส่วนต่าง',
  });
  check('เรียกเงินคืนบางส่วน (500 จาก 2,500)', 200, partial.status, `${partial.code} ${partial.msg}`);
  check('  คำขอยังคงสถานะ PAID ไม่พลิกเป็น REFUNDED', 'PAID', await statusOf(researcher, s.paidRequestId));
  const quotaAfterPartial = (await researcher.get('/auth/me')).json.quota;
  check('  ยังใช้สิทธิ์อยู่ 3 เรื่อง (คืนบางส่วนไม่คืนสิทธิ์)', 3, quotaAfterPartial.used);

  const refundTwice = await admin.post(`/payments/${paidRow.id}/refund`, {
    refundAmount: 100, refundReason: 'ทดสอบเรียกคืนซ้ำ',
  });
  check('เรียกเงินคืนรายการเดิมซ้ำ', 422, refundTwice.status, refundTwice.code);

  // full refund on request #2
  const pay2 = await step(s.finance, a.json.id, 'pay', { voucherNo: `E2E-${RUN}-2`, paidAt: '2026-09-16' });
  check('จ่ายเรื่องที่ 2', 200, pay2.status, `${pay2.code} ${pay2.msg}`);
  const payments2 = await admin.get('/payments?status=paid');
  const row2 = payments2.json.paid.find((p) => String(p.request.id) === String(a.json.id));
  const full = await admin.post(`/payments/${row2.id}/refund`, {
    refundAmount: 3000, refundReason: 'ตรวจพบภายหลังว่าบทความไม่เข้าเกณฑ์',
  });
  check('เรียกเงินคืนเต็มจำนวน', 200, full.status, `${full.code} ${full.msg}`);
  check('  คำขอเปลี่ยนเป็น REFUNDED', 'REFUNDED', await statusOf(researcher, a.json.id));

  const quotaAfterFull = (await researcher.get('/auth/me')).json.quota;
  check('  คืนสิทธิ์ให้ผู้ขอ (เหลือใช้ไป 2 เรื่อง)', 2, quotaAfterFull.used);

  const reclaim = await researcher.post('/requests', draftBody('inflight'));
  created.requests.push(reclaim.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, reclaim.json.id, t);
  const reclaimRes = await step(researcher, reclaim.json.id, 'submit', { isFirstAuthor: true });
  check('ยื่นบทความที่ถูกเรียกเงินคืนใหม่อีกครั้ง', 'DUPLICATE_ARTICLE', reclaimRes.code, `HTTP ${reclaimRes.status}`);

  // rejection does not burn a slot
  const rej = await researcher.post('/requests', draftBody('rej'));
  created.requests.push(rej.json.id);
  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, rej.json.id, t);
  await step(researcher, rej.json.id, 'submit', { isFirstAuthor: true });
  await step(s.qa, rej.json.id, 'approve', {});
  await step(s.dean, rej.json.id, 'approve', {});
  await step(s.rdi, rej.json.id, 'approve', {});
  await step(s.dirAcad, rej.json.id, 'approve', {});
  const rejected = await step(s.approver, rej.json.id, 'reject', { comment: 'บทความไม่อยู่ในฐานข้อมูลที่กำหนด' });
  check('รองอธิการบดีไม่อนุมัติ', 200, rejected.status, `${rejected.code} ${rejected.msg}`);
  check('  สถานะ REJECTED', 'REJECTED', await statusOf(researcher, rej.json.id));
  const quotaAfterReject = (await researcher.get('/auth/me')).json.quota;
  check('  การไม่อนุมัติไม่กินสิทธิ์', 2, quotaAfterReject.used);
}

main().catch((e) => {
  console.error('\nสคริปต์ล้มกลางคัน:', e);
  console.log(`\nRUN_ID=${RUN}`);
  process.exit(1);
});

// --- PART 8: unit-scoped visibility ---------------------------------------

/**
 * A researcher sees their own unit's submitted claims as a summary only:
 * enough to know what the unit has in flight, without the money, the
 * attachments or the detail page.
 */
async function partUnitVisibility(s) {
  head('ส่วนที่ 8 · สิทธิ์มองเห็นตามหน่วยงาน');

  const mateName = `e2e_mate_${RUN}`;
  const mateRes = await admin.post('/users', {
    username: mateName,
    email: `e2e.mate.${RUN}@cpru.ac.th`,
    firstName: 'เพื่อนร่วม',
    lastName: 'หน่วยงาน',
    facultyId: FACULTY.LAS,
    departmentId: DEPT_LAS,
    roles: [{ roleCode: 'RESEARCHER' }],
  });
  check('สร้างเพื่อนร่วมหน่วยงาน (คณะเดียวกับผู้ขอ)', 201, mateRes.status, mateRes.code);
  const mate = new Actor('mate');
  await mate.login(mateName, mateRes.json.tempPassword);

  const outsider = s.qaOther; // FACULTY_QA of EDU - a different unit

  // A fresh draft, not yet submitted.
  const draft = await researcher.post('/requests', draftBody('visibility'));
  const vid = draft.json.id;
  created.requests.push(vid);

  const beforeSubmit = await mate.get('/requests');
  const seesDraft = (beforeSubmit.json.items ?? []).some((r) => String(r.id) === String(vid));
  check('ฉบับร่างของเพื่อนต้องไม่ถูกเห็น', false, seesDraft);

  for (const t of ['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF']) await upload(researcher, vid, t);
  check('เจ้าของยื่นคำขอ', 200, (await step(researcher, vid, 'submit', { isFirstAuthor: true })).status);

  const afterSubmit = await mate.get('/requests');
  const peerRow = (afterSubmit.json.items ?? []).find((r) => String(r.id) === String(vid));
  check('หลังยื่นแล้ว เพื่อนร่วมหน่วยงานเห็นในรายการ', true, Boolean(peerRow));
  check('  ถูกทำเครื่องหมายเป็นรายการย่อ', 'SUMMARY', peerRow?.viewScope);
  check('  ไม่เห็นยอดที่ขอ', null, peerRow?.amountRequested);
  check('  ไม่เห็นยอดที่อนุมัติ', null, peerRow?.amountApproved);
  check('  ไม่เห็นลำดับสิทธิ์', null, peerRow?.sequenceInYear);
  check('  ยังเห็นชื่อบทความและสถานะ', true, Boolean(peerRow?.articleTitle && peerRow?.status));

  check('เพื่อนเปิดหน้ารายละเอียดไม่ได้', 403, (await mate.get(`/requests/${vid}`)).status);
  check('เพื่อนดู timeline ไม่ได้', 403, (await mate.get(`/requests/${vid}/timeline`)).status);
  check('เพื่อนพิมพ์ PDF ไม่ได้', 403, (await mate.get(`/requests/${vid}/document`)).status);
  check('เพื่อนแก้ไขไม่ได้', 403, (await mate.put(`/requests/${vid}`, { volume: '99' })).status);
  check('เพื่อนยกเลิกไม่ได้', 403, (await mate.del(`/requests/${vid}`)).status);
  check('เพื่อนส่งแทนไม่ได้', 403, (await step(mate, vid, 'submit', { isFirstAuthor: true })).status);

  const files = (await researcher.get(`/requests/${vid}`)).json.attachments ?? [];
  if (files[0]) {
    check('เพื่อนโหลดไฟล์แนบไม่ได้', 403, (await mate.get(`/attachments/${files[0].id}/download`)).status);
  }

  const outsiderList = await outsider.get('/requests');
  const outsiderSees = (outsiderList.json.items ?? []).some((r) => String(r.id) === String(vid));
  check('คนต่างหน่วยงานไม่เห็นในรายการ', false, outsiderSees);
  check('คนต่างหน่วยงานเปิดไม่ได้', 403, (await outsider.get(`/requests/${vid}`)).status);

  const ownList = await researcher.get('/requests');
  const ownRow = (ownList.json.items ?? []).find((r) => String(r.id) === String(vid));
  check('เจ้าของยังเห็นข้อมูลของตัวเองครบ', 'OWNER', ownRow?.viewScope);
  check('  เจ้าของเห็นยอดที่ขอของตัวเอง', true, typeof ownRow?.amountRequested === 'number');
}
