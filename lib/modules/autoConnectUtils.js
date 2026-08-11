/* @flow */

export const DEFAULT_THRESHOLD = 25;
export const DEFAULT_BATCH_SIZE = 25;

export function parseMutualCount(text: string): ?number {
	const normalized = text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ');
	const namedOthersMatch = normalized.match(/(\d[\d,]*)\s*other\s*(?:mutual|shared)\s*connections?/i);
	if (namedOthersMatch) {
		const otherCount = Number(namedOthersMatch[1].replace(/,/g, ''));
		return Number.isFinite(otherCount) ? otherCount : null;
	}
	const match = normalized.match(/(\d[\d,]*)\s+(?:mutual|shared)\s+connections?/i) ||
		normalized.match(/(\d[\d,]*)\s+mutuals?/i);
	if (!match) return null;
	const count = Number(match[1].replace(/,/g, ''));
	return Number.isFinite(count) ? count : null;
}

export function getThreshold(value: mixed): number {
	const parsed = Number.parseInt(String(value), 10);
	return Number.isFinite(parsed) ? Math.max(0, Math.min(9999, parsed)) : DEFAULT_THRESHOLD;
}

export function meetsThreshold(mutualCount: number, threshold: mixed): boolean {
	return mutualCount <= getThreshold(threshold);
}

export function getBatchSize(value: mixed): number {
	const parsed = Number.parseInt(String(value), 10);
	return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : DEFAULT_BATCH_SIZE;
}
