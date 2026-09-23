import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlacklistedJournal } from '../src/services/validation.service';

test('a journal on the predatory title list is rejected', () => {
  assert.equal(
    isBlacklistedJournal('International Journal of Psychosocial Rehabilitation'),
    true,
  );
});

test('matching ignores case and extra whitespace', () => {
  assert.equal(isBlacklistedJournal('  test   engineering AND management '), true);
});

test('a journal published by a listed publisher is rejected', () => {
  assert.equal(isBlacklistedJournal('Journal of Nanomedicine - OMICS International'), true);
});

test('a listed ISSN is rejected even when the title looks unfamiliar', () => {
  assert.equal(isBlacklistedJournal('Some Unlisted Journal Name', '2320-9186'), true);
});

test('a legitimate journal passes', () => {
  assert.equal(isBlacklistedJournal('Kasetsart Journal of Social Sciences', '2452-3151'), false);
  assert.equal(isBlacklistedJournal('IEEE Access'), false);
});

test('a partial title match does not trigger a false positive', () => {
  // The blacklist matches whole titles, so a different journal that merely
  // shares wording is not blocked.
  assert.equal(isBlacklistedJournal('Solid State Technology and Materials Science'), false);
});
