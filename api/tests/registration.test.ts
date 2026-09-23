import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSchema } from '../src/validators/registration.schema';
import { createRateLimiter } from '../src/middleware/rate-limit';

/** A complete, valid sign-up as the form would send it. */
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    facultyId: '2',
    staffTrack: 'ACADEMIC',
    departmentName: null,
    firstName: 'สมหญิง',
    lastName: 'ใจงาม',
    phone: '081-234-5678',
    email: 'Somying@CPRU.ac.th',
    password: 'Abcd1234',
    confirmPassword: 'Abcd1234',
    ...overrides,
  };
}

function fieldErrors(input: unknown): Record<string, string> {
  const result = registerSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.') || '_', issue.message]));
}

test('a complete sign-up is accepted and normalised', () => {
  const result = registerSchema.safeParse(validInput());
  assert.ok(result.success);
  if (!result.success) return;
  // Dashes stripped from the phone, email lower-cased for the unique check.
  assert.equal(result.data.phone, '0812345678');
  assert.equal(result.data.email, 'somying@cpru.ac.th');
});

test('the department is optional free text (section 13.2)', () => {
  const { departmentName, ...withoutDepartment } = validInput();
  assert.equal(departmentName, null);
  // Missing, empty and blank all mean "not given".
  assert.ok(registerSchema.safeParse(withoutDepartment).success, 'missing');
  for (const value of ['', '   ']) {
    const result = registerSchema.safeParse(validInput({ departmentName: value }));
    assert.ok(result.success, JSON.stringify(value));
    if (result.success) assert.equal(result.data.departmentName, null);
  }
});

test('a typed department is kept, trimmed', () => {
  const result = registerSchema.safeParse(validInput({ departmentName: '  วิทยาการคอมพิวเตอร์  ' }));
  assert.ok(result.success);
  if (result.success) assert.equal(result.data.departmentName, 'วิทยาการคอมพิวเตอร์');
});

test('a department name longer than 255 characters is rejected', () => {
  assert.equal(fieldErrors(validInput({ departmentName: 'ก'.repeat(256) })).departmentName, 'ชื่อสาขาวิชายาวเกินไป');
});

test('the unit and the staff track are both required', () => {
  const { facultyId, staffTrack, ...rest } = validInput();
  assert.ok(facultyId && staffTrack);
  const errors = fieldErrors(rest);
  assert.ok(errors.facultyId, 'facultyId must be required');
  assert.equal(errors.staffTrack, 'กรุณาเลือกสายงาน/ฝ่าย');
});

test('first name, last name and phone are required', () => {
  const errors = fieldErrors(validInput({ firstName: '  ', lastName: '', phone: '' }));
  assert.equal(errors.firstName, 'กรุณากรอกชื่อ');
  assert.equal(errors.lastName, 'กรุณากรอกนามสกุล');
  assert.ok(errors.phone);
});

test('phone numbers must start with 0 and have 9-10 digits', () => {
  for (const phone of ['0812345678', '081 234 5678', '044-811-111', '021234567']) {
    assert.ok(registerSchema.safeParse(validInput({ phone })).success, `${phone} should pass`);
  }
  for (const phone of ['812345678', '08123', '08123456789', '08a2345678', '+66812345678']) {
    assert.equal(
      fieldErrors(validInput({ phone })).phone,
      'เบอร์โทรศัพท์ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก',
      `${phone} should fail`,
    );
  }
});

test('the password follows the change-password rules', () => {
  assert.ok(fieldErrors(validInput({ password: 'Ab1', confirmPassword: 'Ab1' })).password);
  assert.ok(fieldErrors(validInput({ password: 'abcdefgh', confirmPassword: 'abcdefgh' })).password);
  assert.ok(fieldErrors(validInput({ password: '12345678', confirmPassword: '12345678' })).password);
});

test('the two password fields must match', () => {
  assert.equal(
    fieldErrors(validInput({ confirmPassword: 'Different1' })).confirmPassword,
    'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
  );
});

test('only the two staff tracks exist', () => {
  assert.ok(fieldErrors(validInput({ staffTrack: 'MANAGEMENT' })).staffTrack);
});

test('a client cannot grant itself roles or activate itself', () => {
  // .strict() rejects these outright instead of silently dropping them.
  for (const extra of [
    { roles: [{ roleCode: 'ADMIN' }] },
    { isActive: true },
    { registrationStatus: 'APPROVED' },
  ]) {
    const result = registerSchema.safeParse(validInput(extra));
    assert.equal(result.success, false, `${Object.keys(extra)[0]} must be rejected`);
  }
});

test('the rate limiter allows the quota, then blocks, then resets', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
  const start = 1_000_000;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(limiter.consume('10.0.0.1', start + attempt), true, `attempt ${attempt}`);
  }
  assert.equal(limiter.consume('10.0.0.1', start + 10), false, 'sixth attempt is blocked');

  // Another address has its own budget.
  assert.equal(limiter.consume('10.0.0.2', start + 10), true);

  // A new window opens once the old one expires.
  assert.equal(limiter.consume('10.0.0.1', start + 60_001), true);
});
