import { Router } from 'express';
import { authenticate, requireCronToken, requireRoles } from '../middleware/auth';
import { BUDGET_EDIT_ROLES } from '../config/authz';
import { validateBody, validateQuery } from '../middleware/validate';
import { uploadAttachment as upload } from '../middleware/upload';
import * as authController from '../controllers/auth.controller';
import * as requestController from '../controllers/request.controller';
import * as approvalController from '../controllers/approval.controller';
import * as misc from '../controllers/misc.controller';
import * as registrationController from '../controllers/registration.controller';
import { loginRateLimiter, registerRateLimiter } from '../middleware/rate-limit';
import {
  approveRegistrationSchema,
  listRegistrationsSchema,
  registerSchema,
  rejectRegistrationSchema,
} from '../validators/registration.schema';
import {
  changePasswordSchema,
  budgetYearSchema,
  budgetYearUpdateSchema,
  createUserSchema,
  forgotPasswordSchema,
  journalTierSchema,
  loginSchema,
  paySchema,
  refundSchema,
  resetPasswordSchema,
  updateUserSchema,
  userStatusSchema,
} from '../validators/common.schema';
import {
  approveSchema,
  createRequestSchema,
  finalApproveSchema,
  listRequestsSchema,
  previewAmountSchema,
  qaYearSchema,
  rejectSchema,
  returnSchema,
  submitSchema,
  toCommitteeSchema,
  updateRequestSchema,
} from '../validators/request.schema';

export const router = Router();

// ---------------------------------------------------------------
// Public
// ---------------------------------------------------------------
router.get('/health', misc.health);
router.post(
  '/auth/login',
  loginRateLimiter.middleware,
  validateBody(loginSchema),
  authController.login,
);

// Self-registration (CLAUDE.md section 13). The rate limit runs before
// validation so malformed spam is throttled too.
router.post(
  '/auth/register',
  registerRateLimiter.middleware,
  validateBody(registerSchema),
  registrationController.register,
);
// The sign-up form needs the unit list before anyone is logged in. The
// department is typed as free text, so that list stays behind the session.
router.get('/faculties', misc.listFaculties);
router.post('/auth/forgot-password', validateBody(forgotPasswordSchema), authController.forgotPassword);
router.post('/auth/reset-password', validateBody(resetPasswordSchema), authController.resetPassword);

// cPanel cron calls this once a day; protected by a shared secret header.
router.post('/cron/reminders', requireCronToken, misc.cronReminders);

// ---------------------------------------------------------------
// Everything below requires a session
// ---------------------------------------------------------------
router.use(authenticate);

router.post('/auth/logout', authController.logout);
router.get('/auth/me', authController.me);
router.post('/auth/change-password', validateBody(changePasswordSchema), authController.changePassword);

// --- Requests -------------------------------------------------
router.get('/requests', validateQuery(listRequestsSchema), requestController.list);
router.post('/requests', validateBody(createRequestSchema), requestController.create);
router.post('/requests/preview-amount', validateBody(previewAmountSchema), requestController.previewAmount);
router.get('/requests/my-quota', requestController.myQuota);
router.get('/requests/:id', requestController.detail);
router.put('/requests/:id', validateBody(updateRequestSchema), requestController.update);
router.delete('/requests/:id', requestController.cancel);
router.get('/requests/:id/timeline', requestController.timeline);
router.get('/requests/:id/document', requestController.document);
router.post('/requests/:id/check-submit', requestController.checkSubmit);
router.post('/requests/:id/submit', validateBody(submitSchema), requestController.submit);
router.post('/requests/:id/resubmit', validateBody(submitSchema), requestController.resubmit);

// --- Attachments ----------------------------------------------
router.post('/requests/:id/attachments', upload.single('file'), misc.uploadAttachment);
router.get('/attachments/:id/download', misc.downloadAttachment);
router.delete('/attachments/:id', misc.deleteAttachment);
router.patch('/attachments/:id/verify', requireRoles('RDI_OFFICER', 'ADMIN'), misc.verifyAttachment);

// --- Approvals ------------------------------------------------
// Each handler re-checks role, status, self-approval and faculty scope against
// the workflow table; the role filter here only keeps the queue tidy.
const reviewerRoles = ['FACULTY_QA', 'DEAN', 'RDI_OFFICER', 'ACADEMIC_OFFICE', 'APPROVER'] as const;

router.get('/approvals/inbox', requireRoles(...reviewerRoles), approvalController.inbox);
router.get('/approvals/inbox/count', requireRoles(...reviewerRoles), approvalController.inboxCount);
router.post(
  '/requests/:id/approve',
  requireRoles(...reviewerRoles),
  validateBody(approveSchema),
  approvalController.approve,
);
router.post(
  '/requests/:id/return',
  requireRoles(...reviewerRoles),
  validateBody(returnSchema),
  approvalController.returnToRequester,
);
router.post(
  '/requests/:id/reject',
  requireRoles('APPROVER'),
  validateBody(rejectSchema),
  approvalController.reject,
);
router.post(
  '/requests/:id/final-approve',
  requireRoles('APPROVER'),
  validateBody(finalApproveSchema),
  approvalController.finalApprove,
);
router.post(
  '/requests/:id/to-committee',
  requireRoles('RDI_OFFICER'),
  validateBody(toCommitteeSchema),
  approvalController.toCommittee,
);
router.patch(
  '/requests/:id/qa-year',
  requireRoles('FACULTY_QA', 'ADMIN'),
  validateBody(qaYearSchema),
  approvalController.setQaYear,
);

// --- Budget and payments --------------------------------------
router.get('/budget/summary', requireRoles('FINANCE', 'ADMIN', 'APPROVER'), misc.budgetSummary);
// The approver reads this list: /budget is open to them and the page loads
// nothing else, so without it they reached a page that only showed a permission
// error. Creating and editing a budget year stays with ADMIN below.
router.get('/budget/years', requireRoles('FINANCE', 'ADMIN', 'APPROVER'), misc.listBudgetYears);
router.get(
  '/budget/years/:id/logs',
  requireRoles('FINANCE', 'ADMIN', 'APPROVER'),
  misc.listBudgetYearLogs,
);
router.post('/budget/years', requireRoles('ADMIN'), validateBody(budgetYearSchema), misc.createBudgetYear);
// The ceiling itself is editable by the offices in BUDGET_EDIT_ROLES - one
// list, read by the button on the page as well. Creating a year and opening or
// closing one stay with ADMIN above: those decide which pot claims draw from.
router.put(
  '/budget/years/:id',
  requireRoles(...BUDGET_EDIT_ROLES),
  validateBody(budgetYearUpdateSchema),
  misc.updateBudgetYear,
);
router.get('/payments', requireRoles('FINANCE', 'ADMIN'), misc.listPayments);
router.post('/requests/:id/pay', requireRoles('FINANCE'), validateBody(paySchema), misc.pay);
router.post(
  '/payments/:id/refund',
  requireRoles('FINANCE', 'ADMIN'),
  validateBody(refundSchema),
  misc.refund,
);

// --- Master data ----------------------------------------------
router.get('/journal-tiers', misc.listJournalTiers);
router.post('/journal-tiers', requireRoles('ADMIN'), validateBody(journalTierSchema), misc.createJournalTier);
router.put(
  '/journal-tiers/:id',
  requireRoles('ADMIN'),
  validateBody(journalTierSchema.partial()),
  misc.updateJournalTier,
);
router.get('/faculties/:id/departments', misc.listDepartments);
router.get('/roles', requireRoles('ADMIN'), misc.listRoles);

// --- Registrations (ADMIN) -------------------------------------
router.get(
  '/registrations',
  requireRoles('ADMIN'),
  validateQuery(listRegistrationsSchema),
  registrationController.list,
);
router.get('/registrations/count', requireRoles('ADMIN'), registrationController.count);
router.post(
  '/registrations/:id/approve',
  requireRoles('ADMIN'),
  validateBody(approveRegistrationSchema),
  registrationController.approve,
);
router.post(
  '/registrations/:id/reject',
  requireRoles('ADMIN'),
  validateBody(rejectRegistrationSchema),
  registrationController.reject,
);
router.get('/users/reviewer-coverage', requireRoles('ADMIN'), registrationController.coverage);
router.get('/users', requireRoles('ADMIN'), misc.listUsers);
router.post('/users', requireRoles('ADMIN'), validateBody(createUserSchema), misc.createUser);
router.put('/users/:id', requireRoles('ADMIN'), validateBody(updateUserSchema), misc.updateUser);
router.patch(
  '/users/:id/status',
  requireRoles('ADMIN'),
  validateBody(userStatusSchema),
  misc.setUserStatus,
);

// --- Reports --------------------------------------------------
router.get('/dashboard', misc.dashboard);
// DEAN and RDI_OFFICER added 11 ต.ค. 2569. RDI_OFFICER owns the process under
// ประกาศ ข้อ 9(1) and sees every faculty; a DEAN is narrowed to their own by
// reportFacultyScope, the same scope their dashboard and request list use.
router.get(
  '/reports/by-faculty',
  requireRoles('ADMIN', 'FINANCE', 'APPROVER', 'RDI_OFFICER', 'DEAN', 'ACADEMIC_OFFICE'),
  misc.reportByFaculty,
);
router.get('/reports/by-tier', requireRoles('ADMIN', 'FINANCE'), misc.reportByTier);
router.get(
  '/reports/processing-time',
  requireRoles('ADMIN', 'RDI_OFFICER'),
  misc.reportProcessingTime,
);
router.get(
  '/reports/qa-indicator',
  requireRoles('FACULTY_QA', 'ADMIN', 'DEAN'),
  misc.reportQaIndicator,
);
router.get('/reports/export', requireRoles('ADMIN', 'FINANCE', 'FACULTY_QA'), misc.exportReport);
