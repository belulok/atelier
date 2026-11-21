import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOORS, organisationMembers, occupantsForFloor, parseSession } from './building.js';
import { updateBehavior } from '../office3d/behavior.js';

test('floor travel moves the user and preserves each agent’s actual workflow status', () => {
  const members = organisationMembers([{ id: 'theo', status: 'needs_approval', behavior: 'raisehand', current_task: 'Review cleaning schedule' }]);
  const session = { active: true, startedAt: Date.now(), floor: 2 };
  const operations = occupantsForFloor(members, 2, session);
  assert.equal(operations.find(p => p.id === 'you').floor, 2);
  assert.equal(operations.find(p => p.id === 'theo').status, 'needs_approval');
  assert.equal(operations.find(p => p.id === 'theo').behavior, 'raisehand');
  assert.equal(operations.some(p => p.id === 'mila'), false);
  assert.equal(new Set(operations.map(p => p.desk)).size, operations.length);
  const studio = occupantsForFloor(members, 3, { ...session, floor: 3 });
  assert.equal(studio.find(p => p.id === 'you').floor, 3);
  assert.equal(studio.some(p => p.id === 'theo'), false);
  assert.equal(members.some(p => p.id === 'you'), false, 'The directory must not be mutated by visits');
});

test('every floor fits the scene and sample agents belong to a coworker', () => {
  const members = organisationMembers();
  for (const f of FLOORS) {
    const occupants = occupantsForFloor(members, f.id, { active: false });
    assert.ok(occupants.length <= 8);
    assert.equal(occupants.filter(p => p.isSelf).length, 1);
  }
  for (const p of members.filter(p => p.isSample && p.kind === 'agent')) {
    assert.ok(members.some(owner => owner.kind === 'person' && owner.name === p.owner && owner.floor === p.floor));
  }
});

test('stored work sessions survive reload and malformed or future values recover safely', () => {
  const good = { active: true, startedAt: Date.now() - 3000, floor: 2 };
  assert.deepEqual(parseSession(JSON.stringify(good)), good);
  for (const value of [null, 'broken', '{}', 'null']) {
    assert.deepEqual(parseSession(value), { active: false, startedAt: null, floor: 0 });
  }
  assert.equal(parseSession(JSON.stringify({ ...good, floor: 55 })).floor, 0);
  assert.equal(parseSession(JSON.stringify({ ...good, startedAt: Date.now() + 86400000 })).active, false);
});

test('an outgoing avatar always gets a valid destination during a roster transition', () => {
  const avatar = { agent: { id: 'outgoing-lobby-member', floor: 0, behavior: 'social' },
    slot: { n: 1 }, group: { position: { x: -6.9, z: 3.8 }, rotation: { y: 0 } },
    goal: null, path: [], replanAt: 0 };
  assert.doesNotThrow(() => updateBehavior(avatar, [{ id: 'new-floor-member', floor: 1 }], Date.now(), .033));
  assert.ok(avatar.goal.point.every(Number.isFinite));
  assert.ok(Number.isFinite(avatar.group.position.x) && Number.isFinite(avatar.group.position.z));
});
