/**
 * Removes everything api/scripts/e2e.mjs creates.
 *
 * The test run leaves rows behind on purpose: a failing run is worth reading in
 * the database. This deletes them when you are done.
 *
 * Runs through Prisma rather than psql, so it works the same against the local
 * Postgres container and against Supabase, where no psql client is at hand:
 *
 *   docker exec cpru-pubfee-api-1 node dist/scripts/e2e-cleanup.js   (built image)
 *   node scripts/e2e-cleanup.mjs                                     (host, needs api/.env)
 *
 * Attachments on disk are deleted separately - the uploads volume lives in the
 * api container either way:
 *
 *   docker exec cpru-pubfee-api-1 sh -c 'find /app/storage/uploads -type f -delete'
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Same marks the e2e script stamps on everything it creates. */
const owners = {
  OR: [{ username: { startsWith: 'e2e' } }, { email: { startsWith: 'e2e.' } }],
};

async function main() {
  const users = await prisma.user.findMany({ where: owners, select: { id: true } });
  if (users.length === 0) {
    console.log('ไม่พบข้อมูลทดสอบที่ต้องลบ');
    return;
  }
  const userIds = users.map((user) => user.id);
  const requests = await prisma.request.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const requestIds = requests.map((request) => request.id);

  // Children first: the schema has no cascade on every path, and a half-deleted
  // request would be worse than leaving the lot in place.
  const counts = {};
  if (requestIds.length > 0) {
    counts.payments = (await prisma.payment.deleteMany({ where: { requestId: { in: requestIds } } })).count;
    counts.attachments = (await prisma.requestAttachment.deleteMany({ where: { requestId: { in: requestIds } } })).count;
    counts.approvals = (await prisma.requestApproval.deleteMany({ where: { requestId: { in: requestIds } } })).count;
    counts.statusLogs = (await prisma.requestStatusLog.deleteMany({ where: { requestId: { in: requestIds } } })).count;
    counts.requests = (await prisma.request.deleteMany({ where: { id: { in: requestIds } } })).count;
  }
  // Logs and approvals recorded against a test account on someone else's
  // request would otherwise block the user delete.
  counts.otherLogs = (await prisma.requestStatusLog.deleteMany({ where: { actorId: { in: userIds } } })).count;
  counts.otherApprovals = (await prisma.requestApproval.deleteMany({ where: { approverId: { in: userIds } } })).count;
  counts.roles = (await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })).count;
  counts.users = (await prisma.user.deleteMany({ where: { id: { in: userIds } } })).count;

  for (const [what, n] of Object.entries(counts)) console.log(`  ลบ ${what}: ${n}`);
  const left = await prisma.user.count();
  console.log(`เหลือผู้ใช้ในระบบ ${left} คน`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
