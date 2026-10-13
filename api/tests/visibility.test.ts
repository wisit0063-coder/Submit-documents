import test from 'node:test';
import assert from 'node:assert/strict';
import { canSeeRequest, type Viewer, type ViewableRequest } from '../src/config/authz';

const LAS = 3n;
const EDU = 4n;

const claim = (over: Partial<ViewableRequest> = {}): ViewableRequest => ({
  userId: 100n,
  facultyId: LAS,
  submittedAt: new Date('2026-10-01T03:00:00Z'),
  ...over,
});

/** Never filed: still a draft, or cancelled while it was one. */
const unfiled = (over: Partial<ViewableRequest> = {}) => claim({ submittedAt: null, ...over });

const viewer = (roles: string[], facultyId: bigint | null = null, id = 200n): Viewer => ({
  id,
  roles,
  roleScopes: roles.map((roleCode) => ({ roleCode, facultyId })),
});

const owner: Viewer = viewer(['RESEARCHER'], null, 100n);
const colleague = viewer(['RESEARCHER'], null, 101n);

test('the author always reaches their own claim, filed or not', () => {
  assert.equal(canSeeRequest(owner, claim()), true);
  assert.equal(canSeeRequest(owner, unfiled()), true);
});

test('work that was never filed is nobody else’s business', () => {
  // Every role in the chain, plus the two that see everything.
  for (const roles of [
    ['RESEARCHER'],
    ['FACULTY_QA'],
    ['DEAN'],
    ['RDI_OFFICER'],
    ['ACADEMIC_OFFICE'],
    ['APPROVER'],
    ['FINANCE'],
    ['ADMIN'],
  ]) {
    assert.equal(
      canSeeRequest(viewer(roles, LAS), unfiled()),
      false,
      `${roles[0]} ไม่ควรเปิดงานที่เจ้าตัวยังไม่เคยยื่นได้`,
    );
  }
});

/**
 * The rule used to read "not a draft". Cancelling a draft moves it to
 * CANCELLED, so a status test let it out and the whole unit could read the
 * title and the amount of a claim its author abandoned before ever filing it.
 */
test('cancelling a draft does not publish it to the unit', () => {
  const cancelledBeforeFiling = unfiled();
  assert.equal(canSeeRequest(colleague, cancelledBeforeFiling), false);
  assert.equal(canSeeRequest(viewer(['DEAN'], LAS), cancelledBeforeFiling), false);
  assert.equal(canSeeRequest(viewer(['ADMIN']), cancelledBeforeFiling), false);

  // A claim cancelled after it was filed stays visible: it did enter the
  // workflow, and the units that handled it may still look it up.
  const cancelledAfterFiling = claim();
  assert.equal(canSeeRequest(viewer(['DEAN'], LAS), cancelledAfterFiling), true);
});

test('a filed claim is open to the roles in its approval chain', () => {
  for (const roles of [['RDI_OFFICER'], ['ACADEMIC_OFFICE'], ['APPROVER']]) {
    assert.equal(canSeeRequest(viewer(roles), claim()), true, `${roles[0]} ต้องเปิดได้`);
  }
  assert.equal(canSeeRequest(viewer(['ADMIN']), claim()), true);
  assert.equal(canSeeRequest(viewer(['FINANCE']), claim()), true);
});

test('a faculty-scoped reviewer stays inside their own faculty', () => {
  assert.equal(canSeeRequest(viewer(['FACULTY_QA'], LAS), claim()), true);
  assert.equal(canSeeRequest(viewer(['DEAN'], LAS), claim()), true);
  assert.equal(canSeeRequest(viewer(['FACULTY_QA'], EDU), claim()), false);
  assert.equal(canSeeRequest(viewer(['DEAN'], EDU), claim()), false);
  // Granted without a faculty, which the system treats as covering all of them.
  assert.equal(canSeeRequest(viewer(['DEAN'], null), claim()), true);
});

test('a colleague in the same unit cannot open a filed claim in full', () => {
  // They see it listed, stripped of money by summariseForPeers - never the
  // detail, the timeline, the attachments or the memo.
  assert.equal(canSeeRequest(colleague, claim()), false);
});

test('holding RESEARCHER alongside a reviewing role changes nothing', () => {
  const deanWhoAlsoClaims: Viewer = {
    id: 201n,
    roles: ['RESEARCHER', 'DEAN'],
    roleScopes: [
      { roleCode: 'RESEARCHER', facultyId: null },
      { roleCode: 'DEAN', facultyId: LAS },
    ],
  };
  assert.equal(canSeeRequest(deanWhoAlsoClaims, claim()), true);
  assert.equal(canSeeRequest(deanWhoAlsoClaims, claim({ facultyId: EDU })), false);
  assert.equal(canSeeRequest(deanWhoAlsoClaims, unfiled()), false);
});
