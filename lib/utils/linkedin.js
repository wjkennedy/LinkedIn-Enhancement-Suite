/* @flow */

const FEED_POST_SELECTORS = [
	'div[data-urn*="activity"]',
	'div.feed-shared-update-v2',
	'article',
];

const GAME_LINK_SELECTORS = [
	'a[href*="/games"]',
	'a[href*="linkedin.com/games"]',
	'iframe[src*="/games"]',
];

const GAME_NAME_PATTERN = /\b(?:games?|queens|crossclimb|pinpoint|tango|zip|mini sudoku)\b/i;
const NEWS_LINK_SELECTORS = [
	'a[href*="/news/"]',
	'a[href*="linkedin.com/news"]',
];
const NEWS_PATTERN = /\b(?:LinkedIn News|Today'?s news|Top news|News for you)\b/i;
const FOOTER_LINK_PATTERN = /\b(?:About|Accessibility|Help Center|Privacy|Terms|Ad Choices|Advertising|Business Services|Get the LinkedIn app|LinkedIn Corporation)\b/i;

export type LinkedInPostInfo = {|
	element: HTMLElement,
	text: string,
	authorName: string,
	authorUrl: string,
	relationship: 'self' | 'first' | 'second' | 'third' | 'unknown',
	isPromoted: boolean,
	isSuggested: boolean,
	hasPoll: boolean,
|};

export function isLinkedInHost(hostname: string = location.hostname): boolean {
	return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
}

export function findFeedPosts(root: ParentNode = document): HTMLElement[] {
	const seen = new Set();
	const posts = [];

	for (const selector of FEED_POST_SELECTORS) {
		for (const element of queryElements(root, selector)) {
			if (!(element instanceof HTMLElement) || seen.has(element)) continue;
			if (!isLikelyFeedPost(element)) continue;
			seen.add(element);
			posts.push(element);
		}
	}

	return posts;
}

export function findGameContainers(root: ParentNode = document): HTMLElement[] {
	const seen = new Set();
	const containers = [];

	for (const selector of GAME_LINK_SELECTORS) {
		for (const element of queryElements(root, selector)) {
			if (!(element instanceof HTMLElement) || seen.has(element)) continue;
			if (!isGameElement(element)) continue;

			const container = findBlockableContainer(element);
			if (!container || seen.has(container)) continue;

			seen.add(element);
			seen.add(container);
			containers.push(container);
		}
	}

	return containers;
}

export function findNewsContainers(root: ParentNode = document): HTMLElement[] {
	const seen = new Set();
	const containers = [];

	for (const selector of NEWS_LINK_SELECTORS) {
		for (const element of queryElements(root, selector)) {
			if (!(element instanceof HTMLElement) || seen.has(element)) continue;
			if (!isNewsElement(element)) continue;

			const container = findBlockableContainer(element);
			if (!container || seen.has(container)) continue;

			seen.add(element);
			seen.add(container);
			containers.push(container);
		}
	}

	for (const element of queryElements(root, 'h2, h3, header, [aria-label*="LinkedIn News"], [title*="LinkedIn News"]')) {
		if (seen.has(element)) continue;
		if (!isNewsElement(element)) continue;

		const container = findBlockableContainer(element);
		if (!container || seen.has(container)) continue;

		seen.add(element);
		seen.add(container);
		containers.push(container);
	}

	return containers;
}

export function findRightRailFooterContainers(root: ParentNode = document): HTMLElement[] {
	const seen = new Set();
	const containers = [];

	for (const element of queryElements(root, 'footer, [role="contentinfo"], [class*="footer"], [data-test-id*="footer"]')) {
		if (seen.has(element)) continue;
		if (!isRightRailFooter(element)) continue;

		const container = findBlockableContainer(element);
		if (!container || seen.has(container)) continue;

		seen.add(element);
		seen.add(container);
		containers.push(container);
	}

	return containers;
}

export function getPostInfo(element: HTMLElement): LinkedInPostInfo {
	const text = normalizeText(element.textContent || '');
	const author = findAuthorLink(element);

	return {
		element,
		text,
		authorName: author ? normalizeText(author.textContent || '') : '',
		authorUrl: author ? author.href : '',
		relationship: getRelationship(element),
		isPromoted: /\bpromoted\b/i.test(text),
		isSuggested: /\bsuggested\b/i.test(text),
		hasPoll: !!element.querySelector('[class*="poll"], [data-test*="poll"]') || /\bpoll\b/i.test(text),
	};
}

export function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function isLikelyFeedPost(element: HTMLElement): boolean {
	if (element.closest('[data-les-ignore="true"]')) return false;
	const text = normalizeText(element.textContent || '');
	if (text.length < 20) return false;

	return !!(
		element.matches('article') ||
		element.matches('.feed-shared-update-v2') ||
		element.getAttribute('data-urn') ||
		element.querySelector('a[href*="/in/"], a[href*="/company/"]')
	);
}

function findAuthorLink(element: HTMLElement): ?HTMLAnchorElement {
	const link = element.querySelector('a[href*="/in/"], a[href*="/company/"]');
	return link instanceof HTMLAnchorElement ? link : null;
}

function getRelationship(element: HTMLElement): 'self' | 'first' | 'second' | 'third' | 'unknown' {
	const authorArea = findAuthorArea(element);
	const text = normalizeText(authorArea ? authorArea.textContent || '' : element.textContent || '');

	if (/\b(?:you|view my profile)\b/i.test(text)) return 'self';
	if (/(^|\s)1st($|\s|[·•])/i.test(text)) return 'first';
	if (/(^|\s)2nd($|\s|[·•])/i.test(text)) return 'second';
	if (/(^|\s)3rd\+?($|\s|[·•])/i.test(text)) return 'third';

	return 'unknown';
}

function findAuthorArea(element: HTMLElement): ?HTMLElement {
	const selectors = [
		'.update-components-actor',
		'.feed-shared-actor',
		'.feed-shared-actor__meta',
		'[data-test-id*="actor"]',
		'[class*="actor"]',
	];

	for (const selector of selectors) {
		const candidate = element.querySelector(selector);
		if (candidate instanceof HTMLElement) return candidate;
	}

	const link = findAuthorLink(element);
	return link && link.closest('div');
}

function isGameElement(element: HTMLElement): boolean {
	const href = element instanceof HTMLAnchorElement || element instanceof HTMLIFrameElement ? element.src || element.href : '';
	const text = normalizeText([
		element.getAttribute('aria-label') || '',
		element.getAttribute('title') || '',
		element.textContent || '',
	].join(' '));

	return /(^|\/)games(?:\/|$|\?)/i.test(href) || GAME_NAME_PATTERN.test(text);
}

function isNewsElement(element: HTMLElement): boolean {
	const href = element instanceof HTMLAnchorElement ? element.href : '';
	const text = normalizeText([
		element.getAttribute('aria-label') || '',
		element.getAttribute('title') || '',
		element.textContent || '',
	].join(' '));

	return /(^|\/)news(?:\/|$|\?)/i.test(href) || NEWS_PATTERN.test(text);
}

function isRightRailFooter(element: HTMLElement): boolean {
	const text = normalizeText(element.textContent || '');
	const matches = text.match(new RegExp(FOOTER_LINK_PATTERN.source, 'gi')) || [];

	return matches.length >= 3;
}

function findBlockableContainer(element: HTMLElement): ?HTMLElement {
	const selectors = [
		'footer',
		'article',
		'div[data-urn*="activity"]',
		'.feed-shared-update-v2',
		'li',
		'[role="listitem"]',
		'.artdeco-card',
		'section',
		'[data-view-name]',
	];

	for (const selector of selectors) {
		const candidate = element.closest(selector);
		if (candidate instanceof HTMLElement && isSafeBlockContainer(candidate)) {
			return candidate;
		}
	}

	return isSafeBlockContainer(element) ? element : null;
}

function isSafeBlockContainer(element: HTMLElement): boolean {
	return !['HTML', 'BODY', 'MAIN', 'NAV', 'HEADER'].includes(element.tagName);
}

function queryElements(root: ParentNode, selector: string): HTMLElement[] {
	const elements = [];

	if (root instanceof HTMLElement && root.matches(selector)) {
		elements.push(root);
	}

	for (const element of root.querySelectorAll(selector)) {
		if (element instanceof HTMLElement) elements.push(element);
	}

	return elements;
}
