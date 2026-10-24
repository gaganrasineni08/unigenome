// Merkle tree over a carton's contents (DSA topic 5).
import { sha256Hex } from "../crypto";

export const leafHash = (id: string) => sha256Hex("leaf:" + id);
const nodeHash = (l: string, r: string) => sha256Hex("node:" + l + r);

export interface ProofStep {
  hash: string;
  side: "L" | "R"; // which side the sibling sits on
}

/** All levels, leaves first. An odd node at the end of a level is paired with itself. */
export function buildLevels(leafIds: string[]): string[][] {
  if (leafIds.length === 0) throw new Error("empty Merkle tree");
  const levels: string[][] = [leafIds.map(leafHash)];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(nodeHash(prev[i], prev[i + 1] ?? prev[i]));
    levels.push(next);
  }
  return levels;
}

export const merkleRoot = (leafIds: string[]): string => {
  const levels = buildLevels(leafIds);
  return levels[levels.length - 1][0];
};

export function merkleProof(leafIds: string[], index: number): ProofStep[] {
  const levels = buildLevels(leafIds);
  const proof: ProofStep[] = [];
  let i = index;
  for (let lv = 0; lv < levels.length - 1; lv++) {
    const level = levels[lv];
    const isRight = i % 2 === 1;
    const sib = isRight ? level[i - 1] : level[i + 1] ?? level[i];
    proof.push({ hash: sib, side: isRight ? "L" : "R" });
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leafId: string, proof: ProofStep[], root: string): boolean {
  let h = leafHash(leafId);
  for (const step of proof) h = step.side === "L" ? nodeHash(step.hash, h) : nodeHash(h, step.hash);
  return h === root;
}
