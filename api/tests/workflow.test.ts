import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestStatus } from '@prisma/client';
import {
  ACTIVE_CLAIM_STATUSES,
  CANCELLABLE_STATUSES,
  COMMITTEE_STEP,
  DUPLICATE_BLOCKING_STATUSES,
  ENTITLEMENT_STATUSES,
  FIRST_STEP,
  IN_FLIGHT_STATUSES,
  MAX_ARTICLES_PER_CALENDAR_YEAR,
  STATUS_LABELS_TH,
  WORKFLOW_STEPS,
  stepByCode,
  stepByOrder,
  stepByStatus,
} from '../src/config/workflow';

test('the chain matches the order in CLAUDE.md section 5', () => {
  assert.deepEqual(
    WORKFLOW_STEPS.map((step) => step.status),
    [
      RequestStatus.FACULTY_REVIEW,
      RequestStatus.DEAN_REVIEW,
      RequestStatus.RDI_REVIEW,
      RequestStatus.ACADEMIC_OFFICE_REVIEW,
      RequestStatus.PENDING_APPROVAL,
    ],
  );
});

test('every step hands over to the status of the next step, ending at APPROVED', () => {
  for (const [index, step] of WORKFLOW_STEPS.entries()) {
    const next = WORKFLOW_STEPS[index + 1];
    if (next) {
      assert.equal(step.nextStatus, next.status, `step ${step.stepCode} must lead to ${next.stepCode}`);
    } else {
      assert.equal(step.nextStatus, RequestStatus.APPROVED);
    }
  }
});

test('submitting starts at the faculty QA step', () => {
  assert.equal(FIRST_STEP.status, RequestStatus.FACULTY_REVIEW);
  assert.equal(FIRST_STEP.roleCode, 'FACULTY_QA');
  assert.equal(FIRST_STEP.order, 1);
});

test('only faculty-level steps are scoped to a faculty', () => {
  const scoped = WORKFLOW_STEPS.filter((step) => step.facultyScoped).map((step) => step.roleCode);
  assert.deepEqual(scoped, ['FACULTY_QA', 'DEAN']);
});

test('a status resolves back to exactly one step', () => {
  for (const step of WORKFLOW_STEPS) {
    assert.equal(stepByStatus(step.status)?.order, step.order);
    assert.equal(stepByOrder(step.order)?.status, step.status);
  }
});

test('every step code resolves to a Thai label the memo can print', () => {
  // The printed memo (CPRU-RDI-F011) must never show the enum code: it is an
  // official document. Every code that can reach request_approvals therefore
  // has to resolve, committee review included.
  for (const step of [...WORKFLOW_STEPS, COMMITTEE_STEP]) {
    const found = stepByCode(step.stepCode);
    assert.equal(found?.stepCode, step.stepCode);
    assert.equal(found?.labelTh, step.labelTh);
    assert.ok(found!.labelTh.length > 0, `${step.stepCode} has no Thai label`);
    assert.ok(
      !/^[A-Z_]+$/.test(found!.labelTh),
      `${step.stepCode} still resolves to a code, not a label`,
    );
  }
});

test('committee review is reachable by status and by order', () => {
  assert.equal(stepByStatus(RequestStatus.COMMITTEE_REVIEW)?.stepCode, COMMITTEE_STEP.stepCode);
  assert.equal(stepByOrder(COMMITTEE_STEP.order)?.stepCode, COMMITTEE_STEP.stepCode);
  // Rule: a committee decision rejoins the chain at the academic office.
  assert.equal(COMMITTEE_STEP.nextStatus, RequestStatus.ACADEMIC_OFFICE_REVIEW);
});

test('terminal statuses own no step, so no one can act on them', () => {
  for (const status of [
    RequestStatus.DRAFT,
    RequestStatus.APPROVED,
    RequestStatus.REJECTED,
    RequestStatus.PAID,
    RequestStatus.CANCELLED,
    RequestStatus.REFUNDED,
    RequestStatus.RETURNED,
  ]) {
    assert.equal(stepByStatus(status), undefined, `${status} must not be actionable`);
  }
});

test('cancelling is impossible once the request reaches final approval', () => {
  // Rule 5: cancel is allowed only before PENDING_APPROVAL.
  for (const status of [
    RequestStatus.PENDING_APPROVAL,
    RequestStatus.APPROVED,
    RequestStatus.PAID,
    RequestStatus.REJECTED,
  ]) {
    assert.equal(CANCELLABLE_STATUSES.includes(status), false, `${status} must not be cancellable`);
  }
  assert.equal(CANCELLABLE_STATUSES.includes(RequestStatus.RDI_REVIEW), true);
});

test('only approved and paid requests consume a yearly entitlement', () => {
  // A rejected or cancelled request must not burn one of the three slots.
  assert.equal(ENTITLEMENT_STATUSES.includes(RequestStatus.REJECTED), false);
  assert.equal(ENTITLEMENT_STATUSES.includes(RequestStatus.CANCELLED), false);
  assert.equal(ENTITLEMENT_STATUSES.includes(RequestStatus.DRAFT), false);
  // Money clawed back in full means no compensation was received, so the slot
  // comes back - the same reasoning that keeps a rejected request from using one.
  assert.equal(ENTITLEMENT_STATUSES.includes(RequestStatus.REFUNDED), false);
  // deepEqual narrows the array type, so it goes last.
  assert.deepEqual(ENTITLEMENT_STATUSES, [RequestStatus.APPROVED, RequestStatus.PAID]);
});

test('a refunded article stays un-claimable even though its slot is returned', () => {
  // The two policies are deliberately different: giving the year's slot back
  // must not also let the same article be filed again the next day.
  assert.equal(DUPLICATE_BLOCKING_STATUSES.includes(RequestStatus.REFUNDED), true);
  assert.equal(ENTITLEMENT_STATUSES.includes(RequestStatus.REFUNDED), false);

  // A rejected or cancelled claim blocks nothing - the article may be filed again.
  assert.equal(DUPLICATE_BLOCKING_STATUSES.includes(RequestStatus.REJECTED), false);
  assert.equal(DUPLICATE_BLOCKING_STATUSES.includes(RequestStatus.CANCELLED), false);
});

test('the submit gate also blocks an article already moving through review', () => {
  // Without the in-flight statuses, two copies of one article could be filed at
  // once, pass a settled-only check, and both reach approval.
  for (const status of IN_FLIGHT_STATUSES) {
    assert.equal(ACTIVE_CLAIM_STATUSES.includes(status), true, `${status} must block a re-file`);
  }
  for (const status of DUPLICATE_BLOCKING_STATUSES) {
    assert.equal(ACTIVE_CLAIM_STATUSES.includes(status), true, `${status} must block a re-file`);
  }
  assert.equal(ACTIVE_CLAIM_STATUSES.includes(RequestStatus.REJECTED), false);
  assert.equal(ACTIVE_CLAIM_STATUSES.includes(RequestStatus.CANCELLED), false);
});

test('a returned request still counts as in flight', () => {
  assert.equal(IN_FLIGHT_STATUSES.includes(RequestStatus.RETURNED), true);
  assert.equal(IN_FLIGHT_STATUSES.includes(RequestStatus.APPROVED), false);
});

test('the announcement allows three articles per calendar year', () => {
  assert.equal(MAX_ARTICLES_PER_CALENDAR_YEAR, 3);
});

test('every status has a Thai label for the UI', () => {
  for (const status of Object.values(RequestStatus)) {
    assert.ok(STATUS_LABELS_TH[status], `missing label for ${status}`);
  }
});
