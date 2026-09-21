export const ASSESSMENT_POLICY = {
  importMonths: 12,
  maxGames: 50,
  requestTimeoutMs: 30_000,
  retryDelaysMs: [2_000, 5_000],
  refreshCooldownMs: 60_000,
  verificationNodes: [200_000, 400_000],
  searchWatchdogMs: 15_000,
  cancelTimeoutMs: 1_000,
  materialEvidencePlies: 6,
  evaluationThresholdCp: 100,
  materialThreshold: 1,
  pieceValues: { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9 },
  lowTimeSeconds: 30,
  recurringGameThreshold: 3,
  maxPriorities: 3,
  detectorVersion: 1,
  templateVersion: 1,
} as const;

export function analysisSignature(buildId: string): string {
  if (buildId.trim() === "") throw new TypeError("Engine build ID is required");
  return JSON.stringify({
    engine: buildId,
    nodes: ASSESSMENT_POLICY.verificationNodes,
    watchdogMs: ASSESSMENT_POLICY.searchWatchdogMs,
    evidencePlies: ASSESSMENT_POLICY.materialEvidencePlies,
    evaluationCp: ASSESSMENT_POLICY.evaluationThresholdCp,
    material: ASSESSMENT_POLICY.materialThreshold,
    pieceValues: ASSESSMENT_POLICY.pieceValues,
    lowTimeSeconds: ASSESSMENT_POLICY.lowTimeSeconds,
    detector: ASSESSMENT_POLICY.detectorVersion,
    template: ASSESSMENT_POLICY.templateVersion,
  });
}
