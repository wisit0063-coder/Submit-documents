/**
 * Who may change the ceiling of a fund year.
 *
 * ADMIN runs the system; FINANCE is the office that knows the figure actually
 * allocated to the research fund, and until now had to ask an administrator to
 * type a number the administrator does not own. Creating a fund year, opening
 * and closing one stays with ADMIN alone - those decide which pot every new
 * claim draws from.
 *
 * This is the one place the list lives. The route guard and the button on the
 * budget page both read it (the web copy is in web/src/lib/access.ts and has to
 * say the same thing). If the university says the figure belongs to the
 * research institute or to a vice-president instead, change it here.
 */
export const BUDGET_EDIT_ROLES: string[] = ['ADMIN', 'FINANCE'];

/**
 * Whoever is asking, described by what matters to the rules below. AuthUser
 * satisfies it structurally; it is spelled out here so this file stays free of
 * imports - and therefore free of the database - and can be tested on its own.
 */
export interface Viewer {
  id: bigint;
  roles: string[];
  roleScopes: { roleCode: string; facultyId: bigint | null }[];
}

/** The part of a claim that decides who may read it. */
export interface ViewableRequest {
  userId: bigint;
  facultyId: bigint;
  /** Null until the claimant files it - see canSeeRequest. */
  submittedAt: Date | null;
}

/**
 * Who may open a claim: its author, an admin, finance, or anyone holding a role
 * that appears in the approval chain. Faculty-scoped roles only reach claims
 * belonging to the faculty they are scoped to.
 *
 * Work that was never filed belongs to whoever was writing it, and this is
 * asked of submitted_at rather than of the status on purpose. The rule used to
 * read "not a draft", which let a cancelled draft out: cancelling moves it to
 * CANCELLED, and the whole unit could then read the title and the amount of a
 * claim its author had abandoned before ever filing it. Being filed is what
 * makes a claim other people's business, so that is what this asks.
 */
export function canSeeRequest(viewer: Viewer, request: ViewableRequest): boolean {
  if (request.userId === viewer.id) return true;
  if (request.submittedAt === null) return false;
  if (viewer.roles.includes('ADMIN') || viewer.roles.includes('FINANCE')) return true;

  const facultyScoped = ['FACULTY_QA', 'DEAN'];
  for (const scope of viewer.roleScopes) {
    if (scope.roleCode === 'RESEARCHER') continue;
    if (facultyScoped.includes(scope.roleCode)) {
      if (scope.facultyId === null || scope.facultyId === request.facultyId) return true;
      continue;
    }
    // RDI_OFFICER, ACADEMIC_OFFICE and APPROVER work university-wide.
    if (['RDI_OFFICER', 'ACADEMIC_OFFICE', 'APPROVER'].includes(scope.roleCode)) return true;
  }
  return false;
}
