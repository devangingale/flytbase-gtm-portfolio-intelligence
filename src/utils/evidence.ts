import { SourceDocument, Account, Claim } from '../types/portfolio';

/**
 * Resolves a list of document IDs into concrete SourceDocument objects
 */
export function resolveDocuments(docIds: string[] | undefined, allDocs: SourceDocument[]): SourceDocument[] {
  if (!docIds || !Array.isArray(docIds) || docIds.length === 0) return [];
  const map = new Map<string, SourceDocument>();
  for (const doc of allDocs) {
    map.set(doc.id, doc);
  }
  return docIds
    .map(id => map.get(id))
    .filter((doc): doc is SourceDocument => doc !== undefined);
}

/**
 * Finds all claims across accounts that reference a specific document ID
 */
export function findClaimsForDocument(docId: string, accounts: Account[]): { account: Account; claim: Claim }[] {
  const results: { account: Account; claim: Claim }[] = [];
  for (const account of accounts) {
    if (!account.claims) continue;
    for (const claim of account.claims) {
      if (claim.evidence && claim.evidence.includes(docId)) {
        results.push({ account, claim });
      }
    }
  }
  return results;
}

/**
 * Calculates the count of claims invalidated by a withdrawn document
 */
export function getInvalidatedClaimsCount(docId: string, accounts: Account[]): number {
  return findClaimsForDocument(docId, accounts).length;
}
