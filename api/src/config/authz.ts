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
