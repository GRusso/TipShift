// Pure, dependency-free split of a shift's tips: group shares first, then equal parts per person.
// A group with nobody checked in weighs 0 and its money goes to the groups that do have people.
// Every atomic unit is assigned (the remainder goes one unit at a time, in a deterministic order).

/**
 * @param {{balance: bigint, groups: {groupRef: string, shareBps: number, employeeIds: string[]}[]}} input
 * @returns {{groupRef: string, amount: bigint, people: {employeeId: string, amount: bigint}[]}[]}
 */
export function splitShiftTips({ balance, groups }) {
  if (typeof balance !== 'bigint' || balance < 0n) throw new TypeError('balance must be a non-negative bigint')
  const active = groups.filter((group) => group.employeeIds.length > 0)
  const weight = active.reduce((total, group) => total + BigInt(group.shareBps), 0n)
  const amounts = new Map()
  if (weight > 0n) {
    let assigned = 0n
    const parts = active.map((group) => {
      const exact = balance * BigInt(group.shareBps)
      const amount = exact / weight
      assigned += amount
      return { group, amount, fraction: exact % weight }
    })
    // Largest fractional remainder first; ties broken by group reference, so the result never depends on input order.
    const order = [...parts].sort((a, b) => (a.fraction === b.fraction ? (a.group.groupRef < b.group.groupRef ? -1 : 1) : a.fraction > b.fraction ? -1 : 1))
    for (let index = 0n; index < balance - assigned; index += 1n) order[Number(index) % order.length].amount += 1n
    for (const part of parts) amounts.set(part.group.groupRef, part.amount)
  }
  return groups.map((group) => {
    const amount = amounts.get(group.groupRef) ?? 0n
    const ids = [...group.employeeIds].sort()
    const count = BigInt(ids.length)
    const base = count > 0n ? amount / count : 0n
    const extra = count > 0n ? amount % count : 0n
    return { groupRef: group.groupRef, amount, people: ids.map((employeeId, index) => ({ employeeId, amount: base + (BigInt(index) < extra ? 1n : 0n) })) }
  })
}
