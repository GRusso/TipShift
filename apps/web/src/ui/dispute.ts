export type DisputeState = 'voting' | 'accepted' | 'rejected' | 'withdrawn' | 'correction_voting' | 'corrected' | 'correction_rejected'
export type ProposedShare = { groupRef: string; shareBps: number }
export type Dispute = {
  disputeId: string; state: DisputeState; note: string | null
  createdAt: string; acceptedAt: string | null; proposedAt: string | null; resolvedAt: string | null
  proposedShares: ProposedShare[] | null; proposalNote: string | null
  eligible: number; disputeYes: number; disputeNo: number; correctionYes: number; correctionNo: number
  mine: { opener: boolean; disputeVote: boolean | null; correctionVote: boolean | null } | null
}

/** A dispute that still needs something from someone. */
export const isOpen = (d: Dispute) => d.state === 'voting' || d.state === 'accepted' || d.state === 'correction_voting'

/** The shares that apply to the shift: the newest corrected split if a correction was approved, otherwise the original. */
export function effectiveShares<G extends { groupRef: string; shareBps: number }>(groups: G[], disputes: Dispute[] | undefined): G[] {
  const corrected = (disputes ?? []).find((d) => d.state === 'corrected' && d.proposedShares)
  if (!corrected?.proposedShares) return groups
  return groups.map((g) => ({ ...g, shareBps: Number(corrected.proposedShares?.find((s) => s.groupRef === g.groupRef)?.shareBps ?? g.shareBps) }))
}

/** CSV rows for the disputes of one shift (a second table under the split, so the report keeps the full history). */
export function disputeRows(disputes: Dispute[] | undefined, groupLabel: (groupRef: string) => string): (string | number)[][] {
  if (!disputes?.length) return []
  return [[], ['dispute_state', 'opened_at', 'note', 'agree', 'disagree', 'present', 'proposal_note', 'proposed_split', 'correction_agree', 'correction_disagree'],
    ...disputes.map((d) => [d.state, d.createdAt, d.note ?? '', d.disputeYes, d.disputeNo, d.eligible, d.proposalNote ?? '',
      (d.proposedShares ?? []).map((s) => `${groupLabel(s.groupRef)} ${(Number(s.shareBps) / 100).toFixed(2)}%`).join(' | '), d.correctionYes, d.correctionNo])]
}
