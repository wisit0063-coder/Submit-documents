import { REVIEWER_ROLES } from '@/lib/auth';
import type { RoleCode } from '@/types';

/**
 * Which roles may open each page, in one place so the sidebar and the router
 * can never drift apart. A path missing here is open to anyone signed in.
 *
 * This is for the screen only. Every endpoint enforces its own permissions
 * server side (`requireRoles` in `api/src/routes/index.ts`), so hiding a menu
 * item is never what keeps data safe - it only keeps users out of pages that
 * would answer them with nothing but a permission error.
 */
export const PAGE_ROLES: Record<string, RoleCode[]> = {
  // createRequest refuses anyone without RESEARCHER; without this the form
  // opened for finance or an approver and only failed on save.
  '/requests/new': ['RESEARCHER'],
  '/inbox': REVIEWER_ROLES,
  '/payments': ['FINANCE', 'ADMIN'],
  // RDI_OFFICER since 20 ต.ค. 2569: the fund is the research office's and it
  // sets the ceiling now. FINANCE stays in case the role is ever staffed.
  '/budget': ['FINANCE', 'ADMIN', 'APPROVER', 'RDI_OFFICER'],
  '/reports': [
    'ADMIN',
    'FINANCE',
    'APPROVER',
    'FACULTY_QA',
    'DEAN',
    'RDI_OFFICER',
    'ACADEMIC_OFFICE',
  ],
  '/admin/registrations': ['ADMIN'],
  '/admin/users': ['ADMIN'],
  '/admin/positions': ['ADMIN'],
  '/admin/journal-tiers': ['ADMIN'],
};

export function rolesForPath(path: string): RoleCode[] | undefined {
  return PAGE_ROLES[path];
}

/**
 * Who may change the ceiling of a fund year. Must stay in step with
 * BUDGET_EDIT_ROLES in api/src/config/authz.ts, which is what actually enforces
 * it - this copy only decides whether the button is drawn.
 *
 * Creating a year, and opening or closing one, is ADMIN alone: those pick the
 * pot every new claim draws from.
 */
export const BUDGET_EDIT_ROLES: RoleCode[] = ['ADMIN', 'RDI_OFFICER'];

/**
 * Who sees the "ยกเลิกหลังอนุมัติ" button. Must match REVOKE_ROLES in
 * api/src/config/authz.ts, which is what enforces it.
 */
export const REVOKE_ROLES: RoleCode[] = ['RDI_OFFICER', 'ADMIN'];
