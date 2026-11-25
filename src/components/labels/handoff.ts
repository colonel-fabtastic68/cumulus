/**
 * A one-time note from one Labels & barcodes screen to the next: which items the
 * new-codes steps start with, which codes the list should tick. It lives for
 * the tab's current visit only, so a reload simply starts clean.
 */
export interface LabelsHandoff {
  /** Item ids the new-codes steps start with ticked. */
  pick?: string[];
  /** Item ids the list ticks, ready to print or export. */
  select?: string[];
  /** What was just saved, for the list's confirmation. */
  made?: { made: number; replaced: number };
}

let pending: LabelsHandoff | null = null;

export function leaveHandoff(note: LabelsHandoff): void {
  pending = note;
}

export function peekHandoff(): LabelsHandoff | null {
  return pending;
}

export function clearHandoff(): void {
  pending = null;
}
