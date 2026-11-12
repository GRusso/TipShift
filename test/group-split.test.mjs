import assert from 'node:assert/strict'
import test from 'node:test'
import { splitShiftTips } from '../src/core/group-split.mjs'

const total = (result) => result.flatMap((group) => group.people).reduce((sum, person) => sum + person.amount, 0n)

test('equal split inside a group, group shares between groups', () => {
  const result = splitShiftTips({ balance: 100_000_000n, groups: [
    { groupRef: 'a', shareBps: 6000, employeeIds: ['e1', 'e2'] },
    { groupRef: 'b', shareBps: 4000, employeeIds: ['e3'] },
  ] })
  assert.equal(result[0].amount, 60_000_000n)
  assert.deepEqual(result[0].people.map((p) => p.amount), [30_000_000n, 30_000_000n])
  assert.equal(result[1].people[0].amount, 40_000_000n)
})

test('a group with nobody checked in weighs 0 and its money goes to the rest', () => {
  const result = splitShiftTips({ balance: 90n, groups: [
    { groupRef: 'a', shareBps: 5000, employeeIds: ['e1'] },
    { groupRef: 'b', shareBps: 5000, employeeIds: [] },
  ] })
  assert.equal(result[0].amount, 90n)
  assert.equal(result[1].amount, 0n)
})

test('nobody checked in anywhere: nothing is assigned', () => {
  const result = splitShiftTips({ balance: 10n, groups: [{ groupRef: 'a', shareBps: 10000, employeeIds: [] }] })
  assert.equal(total(result), 0n)
})

test('every atomic unit is assigned and the result ignores input order', () => {
  const groups = [
    { groupRef: 'a', shareBps: 3333, employeeIds: ['e1', 'e2', 'e3'] },
    { groupRef: 'b', shareBps: 3333, employeeIds: ['e4', 'e5'] },
    { groupRef: 'c', shareBps: 3334, employeeIds: ['e6'] },
  ]
  const forward = splitShiftTips({ balance: 1_000_001n, groups })
  assert.equal(total(forward), 1_000_001n)
  const reversed = splitShiftTips({ balance: 1_000_001n, groups: [...groups].reverse().map((g) => ({ ...g, employeeIds: [...g.employeeIds].reverse() })) })
  const key = (r) => JSON.stringify(r.map((g) => [g.groupRef, g.amount.toString(), g.people.map((p) => [p.employeeId, p.amount.toString()])]).sort())
  assert.equal(key(forward), key(reversed))
})
