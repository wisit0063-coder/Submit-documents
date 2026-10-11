import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Reference data for a fresh install.
 *
 * Rates come from ประกาศมหาวิทยาลัยราชภัฏชัยภูมิ เลขที่ 2131/2566 and are stored
 * as data, never as constants in code, because a new announcement changes them.
 */
const ROLES = [
  { code: 'RESEARCHER', nameTh: 'ผู้ขอรับค่าตอบแทน', description: 'ยื่นคำขอและติดตามสถานะ' },
  { code: 'FACULTY_QA', nameTh: 'เจ้าหน้าที่ประกันคุณภาพระดับคณะ', description: 'ตรวจสอบระดับคณะ' },
  { code: 'DEAN', nameTh: 'คณบดี', description: 'เห็นชอบระดับคณะ' },
  { code: 'RDI_OFFICER', nameTh: 'เจ้าหน้าที่สถาบันวิจัยและพัฒนา', description: 'ตรวจคุณสมบัติและหลักฐาน' },
  { code: 'ACADEMIC_OFFICE', nameTh: 'ผู้อำนวยการสำนักส่งเสริมวิชาการฯ', description: 'ให้ความเห็นก่อนเสนออนุมัติ' },
  { code: 'APPROVER', nameTh: 'รองอธิการบดีฝ่ายวิจัยฯ', description: 'อนุมัติและระบุจำนวนเงิน' },
  { code: 'FINANCE', nameTh: 'งานการเงิน / กองคลัง', description: 'บันทึกจ่ายจริงและเรียกเงินคืน' },
  { code: 'ADMIN', nameTh: 'ผู้ดูแลระบบ', description: 'จัดการผู้ใช้ อัตรา และวงเงิน' },
];

const FACULTIES = [
  // The six units of the sign-up form, CLAUDE.md section 13.2.
  // sortOrder is the order the owner asked for in the dropdown, offices first.
  { code: 'ACAD', sortOrder: 1, nameTh: 'สำนักส่งเสริมวิชาการและการเรียนรู้ตลอดชีวิต', nameEn: 'Office of Academic Promotion and Lifelong Learning' },
  { code: 'PRES', sortOrder: 2, nameTh: 'สำนักงานอธิการบดี', nameEn: 'Office of the President' },
  { code: 'INTERNAL', sortOrder: 3, nameTh: 'หน่วยตรวจสอบภายใน', nameEn: 'Internal Audit Unit' },
  { code: 'LAS', sortOrder: 4, nameTh: 'คณะศิลปศาสตร์และวิทยาศาสตร์', nameEn: 'Faculty of Liberal Arts and Science' },
  { code: 'EDU', sortOrder: 5, nameTh: 'คณะครุศาสตร์และการพัฒนามนุษย์', nameEn: 'Faculty of Education and Human Development' },
  { code: 'NUR', sortOrder: 6, nameTh: 'คณะพยาบาลศาสตร์', nameEn: 'Faculty of Nursing' },
];

/**
 * requests.department_id is NOT NULL, so every unit needs at least one row
 * (section 13.6). The real list of สาขาวิชา per unit is still pending (Q5):
 * until it arrives each unit has only this general row. Add the real names
 * here - rows are keyed by code, so re-seeding updates them in place.
 */
const GENERAL_DEPARTMENT = { code: 'GEN', nameTh: 'งานบริหารทั่วไป' };
const DEPARTMENTS: Record<string, { code: string; nameTh: string }[]> = {
  LAS: [GENERAL_DEPARTMENT],
  EDU: [GENERAL_DEPARTMENT],
  NUR: [GENERAL_DEPARTMENT],
  PRES: [GENERAL_DEPARTMENT],
  ACAD: [GENERAL_DEPARTMENT],
  INTERNAL: [GENERAL_DEPARTMENT],
};

const JOURNAL_TIERS = [
  { code: 'SCOPUS_Q1', nameTh: 'Scopus ควอไทล์ 1', databaseName: 'Scopus', quartile: 'Q1', rateNormal: 30000, rateConference: 18000, sortOrder: 1 },
  { code: 'SCOPUS_Q2', nameTh: 'Scopus ควอไทล์ 2', databaseName: 'Scopus', quartile: 'Q2', rateNormal: 20000, rateConference: 12000, sortOrder: 2 },
  { code: 'SCOPUS_Q3', nameTh: 'Scopus ควอไทล์ 3', databaseName: 'Scopus', quartile: 'Q3', rateNormal: 15000, rateConference: 8000, sortOrder: 3 },
  { code: 'SCOPUS_Q4', nameTh: 'Scopus ควอไทล์ 4', databaseName: 'Scopus', quartile: 'Q4', rateNormal: 10000, rateConference: 5000, sortOrder: 4 },
  { code: 'WOS_ISI', nameTh: 'Web of Science (ISI) หรือตามประกาศ ก.พ.อ.', databaseName: 'Web of Science', quartile: null, rateNormal: 10000, rateConference: 7000, sortOrder: 5 },
  { code: 'ACI', nameTh: 'ACI (ฐานข้อมูลกลุ่มอาเซียน)', databaseName: 'ACI', quartile: null, rateNormal: 7000, rateConference: 5000, sortOrder: 6, isActive: false },
  { code: 'TCI_1', nameTh: 'TCI กลุ่มที่ 1', databaseName: 'TCI', quartile: null, rateNormal: 5000, rateConference: 3000, sortOrder: 7 },
  { code: 'TCI_2', nameTh: 'TCI กลุ่มที่ 2', databaseName: 'TCI', quartile: null, rateNormal: 3000, rateConference: 1500, sortOrder: 8 },
];

async function main() {
  console.info('seeding reference data...');

  for (const role of ROLES) {
    await prisma.role.upsert({ where: { code: role.code }, update: role, create: role });
  }

  for (const faculty of FACULTIES) {
    const created = await prisma.faculty.upsert({
      where: { code: faculty.code },
      update: { ...faculty, isActive: true },
      create: faculty,
    });

    const departments = DEPARTMENTS[faculty.code] ?? [];
    for (const department of departments) {
      const code = `${faculty.code}-${department.code}`;
      await prisma.department.upsert({
        where: { facultyId_code: { facultyId: created.id, code } },
        update: { nameTh: department.nameTh, isActive: true },
        create: { facultyId: created.id, code, nameTh: department.nameTh },
      });
    }

    // Departments that are no longer listed are switched off, not deleted:
    // existing requests still point at them.
    await prisma.department.updateMany({
      where: {
        facultyId: created.id,
        code: { notIn: departments.map((department) => `${faculty.code}-${department.code}`) },
      },
      data: { isActive: false },
    });
  }

  // Same for units from an earlier seed (the first draft used placeholder
  // faculties): hidden from every dropdown, kept for historical requests.
  await prisma.faculty.updateMany({
    where: { code: { notIn: FACULTIES.map((faculty) => faculty.code) } },
    data: { isActive: false },
  });

  for (const tier of JOURNAL_TIERS) {
    const data = {
      nameTh: tier.nameTh,
      databaseName: tier.databaseName,
      quartile: tier.quartile ?? null,
      rateNormal: new Prisma.Decimal(tier.rateNormal),
      rateConference: new Prisma.Decimal(tier.rateConference),
      announcementRef: '2131/2566',
      effectiveFrom: new Date('2023-10-01'),
      // ACI stopped operating in December 2024. The tier is deactivated rather
      // than deleted because older requests still reference it.
      effectiveTo: tier.isActive === false ? new Date('2024-12-31') : null,
      isActive: tier.isActive ?? true,
      sortOrder: tier.sortOrder,
    };
    await prisma.journalTier.upsert({
      where: { code: tier.code },
      update: data,
      create: { code: tier.code, ...data },
    });
  }

  // Fiscal year 2569 runs 1 Oct 2025 - 30 Sep 2026.
  await prisma.budgetYear.upsert({
    where: { year: 2569 },
    update: {},
    create: {
      year: 2569,
      totalAmount: new Prisma.Decimal(1_500_000),
      startDate: new Date('2025-10-01'),
      endDate: new Date('2026-09-30'),
      isActive: true,
      note: 'วงเงินกองทุนวิจัยสำหรับค่าตอบแทนการตีพิมพ์ ปีงบประมาณ 2569',
    },
  });

  await seedDemoUsers();

  console.info('seed complete');
}

/**
 * Demo accounts, created only when the users table is empty, so re-seeding a
 * live database never resurrects them. All share the same first-time password
 * and are forced to change it at first login.
 */
async function seedDemoUsers() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.info('users already present - skipping demo accounts');
    return;
  }

  const passwordHash = await bcrypt.hash('Cpru@2569', 10);

  async function unit(code: string) {
    const faculty = await prisma.faculty.findUniqueOrThrow({ where: { code } });
    const department = await prisma.department.findFirstOrThrow({
      where: { facultyId: faculty.id, isActive: true },
    });
    return { facultyId: faculty.id, departmentId: department.id };
  }

  const las = await unit('LAS');
  const edu = await unit('EDU');
  const acad = await unit('ACAD');
  const pres = await unit('PRES');

  const roleByCode = new Map(
    (await prisma.role.findMany()).map((role) => [role.code, role.id] as const),
  );

  const accounts: {
    username: string;
    email: string;
    prefix: string;
    firstName: string;
    lastName: string;
    academicPosition?: string;
    unit: { facultyId: bigint; departmentId: bigint };
    staffTrack: 'ACADEMIC' | 'SUPPORT';
    roles: { code: string; facultyId?: bigint }[];
  }[] = [
    {
      username: 'researcher',
      email: 'researcher@cpru.ac.th',
      prefix: 'ผศ.ดร.',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      academicPosition: 'ผู้ช่วยศาสตราจารย์',
      unit: las,
      staffTrack: 'ACADEMIC',
      roles: [{ code: 'RESEARCHER' }],
    },
    {
      username: 'facultyqa',
      email: 'qa.sci@cpru.ac.th',
      prefix: 'นางสาว',
      firstName: 'ปวีณา',
      lastName: 'ประกันคุณภาพ',
      unit: las,
      staffTrack: 'SUPPORT',
      roles: [{ code: 'RESEARCHER' }, { code: 'FACULTY_QA', facultyId: las.facultyId }],
    },
    {
      username: 'dean',
      email: 'dean.sci@cpru.ac.th',
      prefix: 'รศ.ดร.',
      firstName: 'อนุชา',
      lastName: 'วิทยาการ',
      academicPosition: 'รองศาสตราจารย์',
      unit: las,
      staffTrack: 'ACADEMIC',
      // A dean who also files their own claims - the reason roles are many-to-many.
      roles: [{ code: 'RESEARCHER' }, { code: 'DEAN', facultyId: las.facultyId }],
    },
    {
      username: 'deanedu',
      email: 'dean.edu@cpru.ac.th',
      prefix: 'ผศ.ดร.',
      firstName: 'มาลี',
      lastName: 'ครุศาสตร์',
      academicPosition: 'ผู้ช่วยศาสตราจารย์',
      unit: edu,
      staffTrack: 'ACADEMIC',
      roles: [{ code: 'RESEARCHER' }, { code: 'DEAN', facultyId: edu.facultyId }],
    },
    {
      username: 'rdi',
      email: 'rdi.officer@cpru.ac.th',
      prefix: 'นาย',
      firstName: 'กิตติ',
      lastName: 'วิจัยพัฒนา',
      unit: pres,
      staffTrack: 'SUPPORT',
      roles: [{ code: 'RDI_OFFICER' }],
    },
    {
      username: 'academic',
      email: 'academic.office@cpru.ac.th',
      prefix: 'ผศ.',
      firstName: 'สุดา',
      lastName: 'ส่งเสริมวิชาการ',
      unit: acad,
      staffTrack: 'ACADEMIC',
      roles: [{ code: 'ACADEMIC_OFFICE' }],
    },
    {
      username: 'approver',
      email: 'vp.research@cpru.ac.th',
      prefix: 'รศ.ดร.',
      firstName: 'ธนกฤต',
      lastName: 'รองอธิการบดี',
      academicPosition: 'รองศาสตราจารย์',
      unit: pres,
      staffTrack: 'ACADEMIC',
      roles: [{ code: 'APPROVER' }],
    },
    {
      username: 'finance',
      email: 'finance@cpru.ac.th',
      prefix: 'นาง',
      firstName: 'รัตนา',
      lastName: 'การเงิน',
      unit: pres,
      staffTrack: 'SUPPORT',
      roles: [{ code: 'FINANCE' }],
    },
    {
      username: 'admin',
      email: 'admin@cpru.ac.th',
      prefix: 'นาย',
      firstName: 'ผู้ดูแล',
      lastName: 'ระบบ',
      unit: pres,
      staffTrack: 'SUPPORT',
      roles: [{ code: 'ADMIN' }, { code: 'FINANCE' }],
    },
  ];

  for (const account of accounts) {
    const user = await prisma.user.create({
      data: {
        username: account.username,
        email: account.email,
        passwordHash,
        mustChangePassword: true,
        prefix: account.prefix,
        firstName: account.firstName,
        lastName: account.lastName,
        academicPosition: account.academicPosition ?? null,
        facultyId: account.unit.facultyId,
        departmentId: account.unit.departmentId,
        staffTrack: account.staffTrack,
      },
    });

    for (const role of account.roles) {
      const roleId = roleByCode.get(role.code);
      if (!roleId) continue;
      await prisma.userRole.create({
        data: { userId: user.id, roleId, facultyId: role.facultyId ?? null },
      });
    }
  }

  // One application waiting for review, so the admin approval screen has
  // something to show in a demo (CLAUDE.md section 13.4). It has no roles
  // and cannot log in until an admin approves it.
  const nur = await unit('NUR');
  await prisma.user.create({
    data: {
      username: 'applicant@cpru.ac.th',
      email: 'applicant@cpru.ac.th',
      passwordHash,
      mustChangePassword: false,
      firstName: 'สมหญิง',
      lastName: 'ใจงาม',
      phoneMobile: '0812345678',
      facultyId: nur.facultyId,
      // Typed by the applicant, not linked to a departments row.
      departmentName: 'การพยาบาลผู้ใหญ่',
      staffTrack: 'ACADEMIC',
      isActive: false,
      registrationStatus: 'PENDING',
    },
  });

  console.info(
    `created ${accounts.length} demo accounts and 1 pending application (password: Cpru@2569)`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
