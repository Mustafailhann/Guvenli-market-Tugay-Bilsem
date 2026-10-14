'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectParents } = require('./prepare-firestore-access');

const parent = (id, telefonNo, authID) => ({
  id,
  data: () => ({ telefonNo, authID }),
});

test('unlinked invalid and duplicate phones are excluded as complete groups', () => {
  const result = selectParents([
    parent('valid', '0555 123 45 67'),
    parent('duplicate-a', '0532 123 45 67'),
    parent('duplicate-b', '5321234567'),
    parent('invalid', '0'),
  ]);
  assert.deepEqual(result.eligible.map(({ item }) => item.id), ['valid']);
  assert.equal(result.excluded.length, 2);
  assert.match(result.excluded.join(' '), /duplicate-a, duplicate-b/);
  assert.deepEqual(result.problems, []);
});

test('linked invalid and duplicate accounts remain blocking errors', () => {
  const result = selectParents([
    parent('duplicate-a', '0532 123 45 67', 'auth-uid'),
    parent('duplicate-b', '5321234567'),
    parent('invalid', '', 'other-uid'),
  ]);
  assert.equal(result.eligible.length, 0);
  assert.equal(result.problems.length, 2);
  assert.deepEqual(result.excluded, []);
});
