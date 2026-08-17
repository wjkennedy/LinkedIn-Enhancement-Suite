/* @flow */

import { Module } from '../core/module';
import { string } from '../utils';
import { isLinkedInHost } from '../utils/linkedin';
import {
	DEFAULT_BATCH_SIZE,
	DEFAULT_THRESHOLD,
	getBatchSize,
	getThreshold,
	meetsThreshold,
	parseMutualCount,
} from './autoConnectUtils.js';

export { getBatchSize, getThreshold, meetsThreshold, parseMutualCount } from './autoConnectUtils.js';

export const module: Module<*> = new Module('autoConnect');

type Candidate = {
	key: string,
	card: HTMLElement,
	button: HTMLButtonElement,
	name: string,
	profileUrl: string,
	profileImageUrl: string,
	headline: string,
	company: string,
	location: string,
	followed: ?boolean,
	mutualCount: number,
};

type QueueEntry = {
	candidate: Candidate,
	message: string,
	status: 'queued' | 'sending' | 'sent' | 'failed',
	error: string,
	attempts: number,
};

const MANAGER_CLASS = 'les-auto-connect-manager';
const CARD_SELECTOR = [
	'.mn-pymk-list__card',
	'.mn-connection-card',
	'.discover-entity-type-card',
	'.discover-entity-type-card__container',
	'.entity-result',
	'[data-view-name*="pymk" i]',
	'[data-view-name*="people-you-may-know" i]',
	'[data-view-name*="entity" i]',
	'li',
].join(', ');
const CONNECT_LABEL = /^(?:connect(?: with .+)?|invite .+ to connect)$/i;
const STATUS_LABEL = /^(?:pending|invited|connected|following|message|remove connection)$/i;
const MIN_PACING_MS = 8000;
const MAX_PACING_MS = 20000;
const ACTION_TIMEOUT_MS = 8000;

module.moduleName = 'Auto-Connect';
module.category = 'LinkedIn';
module.description = 'Build and review a queue of suggested connections, then send requests at a measured pace.';
module.options = {
	enabled: {
		type: 'boolean',
		value: true,
		title: 'Show the Auto-Connect queue',
		description: 'Collect qualifying suggestions in My Network so you can review them before sending connection requests.',
	},
	mutualThreshold: {
		type: 'text',
		value: String(DEFAULT_THRESHOLD),
		title: 'Maximum mutual connections',
		description: 'Queue people whose displayed mutual-connection count is no greater than this number.',
	},
	batchSize: {
		type: 'text',
		value: String(DEFAULT_BATCH_SIZE),
		title: 'Connections per run',
		description: 'Limit how many reviewed connection requests Auto-Connect sends in one run.',
	},
	requestNote: {
		type: 'text',
		value: '',
		title: 'Default connection message',
		description: 'Optional message added to each queued request. You can edit it for each person before connecting.',
	},
};
module.alwaysEnabled = true;
module.shouldRun = () => isLinkedInHost();
module.onInit = () => startAutoConnect();
module.contentStart = () => startAutoConnect();
module.onSaveSettings = () => scheduleScan();

let started = false;
let startupScheduled = false;
let manager: ?HTMLElement;
let observer: ?MutationObserver;
let scanTimer: ?TimeoutID;
let refreshRequested = false;
let sending = false;
let currentCandidates: Candidate[] = [];
let scanDiagnostics = {
	connectButtons: 0,
	mutualCounts: 0,
	aboveThreshold: 0,
	qualifying: 0,
};
let lastDiagnosticSignature = '';
const queue = new Map();
const unqueuedKeys = new Set();

function isMyNetwork(): boolean {
	return /^\/mynetwork(?:\/|$)/i.test(location.pathname);
}

function textOf(element: Element): string {
	return [element.textContent || '', element.getAttribute('aria-label') || '', element.getAttribute('title') || ''].join(' ');
}

function candidateText(element: HTMLElement): string {
	const accessibleText = Array.from(element.querySelectorAll('[aria-label], [title]'))
		.map(descendant => [descendant.getAttribute('aria-label') || '', descendant.getAttribute('title') || ''].join(' '));
	return [textOf(element), element.innerText || '', ...accessibleText].join(' ');
}

function isVisible(element: HTMLElement): boolean {
	return !!(element.offsetParent || element.getClientRects().length);
}

function findProfile(card: HTMLElement, button: HTMLButtonElement): { name: string, url: string } {
	const linkSelector = [
		'a[href*="/in/" i][aria-label]',
		'a[href*="/in/" i][data-test-id*="name" i]',
		'a[href*="/in/" i].mn-person-card__person-name',
		'a[href*="/in/" i]',
	].join(', ');
	const labelledName = card.querySelector('[data-anonymize="person-name"]');
	let link = labelledName instanceof Element ? labelledName.closest('a[href*="/in/" i]') : null;
	if (!(link instanceof HTMLAnchorElement)) link = card.querySelector(linkSelector);
	let ancestor = button.parentElement;
	let depth = 0;
	while (!(link instanceof HTMLAnchorElement) && ancestor && ancestor !== document.body && depth < 3) {
		link = ancestor.querySelector(linkSelector);
		ancestor = ancestor.parentElement;
		depth++;
	}
	if (!(link instanceof HTMLAnchorElement)) {
		const nameParagraph = card.querySelector('p');
		const cardName = nameParagraph instanceof HTMLElement ?
			(nameParagraph.innerText || nameParagraph.textContent || '').replace(/\s+/g, ' ').trim() : '';
		const label = button.getAttribute('aria-label') || button.getAttribute('title') || '';
		const normalizedLabel = label.replace(/\s+/g, ' ').trim();
		const labelMatch = normalizedLabel.match(/^(?:connect with|invite)\s+(.+?)(?:\s+to connect)?$/i);
		return { name: cardName || (labelMatch ? labelMatch[1].trim() : 'Unknown person'), url: '' };
	}
	const accessibleName = link.getAttribute('aria-label');
	const visibleName = (link.innerText || link.textContent || '').split(/\r?\n/)[0].trim();
	return {
		name: (accessibleName || visibleName || 'Unknown person').trim(),
		url: link.href,
	};
}

function findProfileImage(card: HTMLElement): string {
	const image = card.querySelector('img[src*="profile" i], img[alt*="open to work" i]');
	return image instanceof HTMLImageElement ? image.currentSrc || image.src : '';
}

function detailText(card: HTMLElement, selectors: string[]): string {
	for (const selector of selectors) {
		const element = card.querySelector(selector);
		if (!(element instanceof HTMLElement)) continue;
		const value = [
			element.innerText || '',
			element.textContent || '',
			element.getAttribute('aria-label') || '',
			element.getAttribute('title') || '',
		].join(' ').replace(/\s+/g, ' ').trim();
		if (value) return value;
	}
	return '';
}

function findCandidateDetails(card: HTMLElement, name: string): {
	headline: string,
	company: string,
	location: string,
	followed: ?boolean,
} {
	const cardLines = Array.from(new Set([
		card.innerText || '',
		card.textContent || '',
		...Array.from(card.querySelectorAll('[aria-label], [title]')).flatMap(element => [
			element.getAttribute('aria-label') || '',
			element.getAttribute('title') || '',
		]),
	].join('\n').split(/\r?\n/)
		.map(line => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)))
		.filter(line => line.toLowerCase() !== name.toLowerCase())
		.filter(line => parseMutualCount(line) === null)
		.filter(line => !/^(?:connect|invite|follow|following|unfollow|message|remove connection|more)$/i.test(line));
	const companyLink = card.querySelector('a[href*="/company/" i]');
	const company = companyLink instanceof HTMLElement ?
		(companyLink.innerText || companyLink.textContent || '').replace(/\s+/g, ' ').trim() :
		detailText(card, [
			'[data-field="company"]',
			'[data-test-company-name]',
			'[data-anonymize="company"]',
			'[data-anonymize="company-name"]',
			'[class*="company" i] > span',
			'.mn-pymk-list__card-company',
			'[aria-label*="company" i]',
		]);
	const followControl = Array.from(card.querySelectorAll('button, [role="button"]')).find(control => {
		const label = [control.textContent || '', control.getAttribute('aria-label') || '', control.getAttribute('title') || '']
			.join(' ').replace(/\s+/g, ' ').trim();
		return /^(?:follow|following|unfollow)\b/i.test(label);
	});
	const followLabel = followControl && [
		followControl.textContent || '',
		followControl.getAttribute('aria-label') || '',
		followControl.getAttribute('title') || '',
	].join(' ').replace(/\s+/g, ' ').trim();

	const paragraphLines = Array.from(card.querySelectorAll('p'))
		.map(paragraph => (paragraph.innerText || paragraph.textContent || '').replace(/\s+/g, ' ').trim())
		.filter(Boolean);
	const headline = detailText(card, [
		'.mn-pymk-list__card-subtitle',
		'.mn-connection-card__occupation',
		'.mn-person-info__occupation',
		'.entity-result__primary-subtitle',
		'[data-field="headline"]',
		'[data-anonymize="headline"]',
		'[data-anonymize="occupation"]',
		'[class*="headline" i]',
		'[class*="occupation" i]',
		'[aria-label*="headline" i]',
		'[aria-label*="occupation" i]',
	]) || paragraphLines.find(line => line.toLowerCase() !== name.toLowerCase()) || cardLines[0] || '';
	const location = detailText(card, [
		'.mn-pymk-list__card-location',
		'.mn-person-info__location',
		'.entity-result__secondary-subtitle',
		'[data-field="location"]',
		'[data-anonymize="location"]',
		'[data-test-location]',
		'[class*="location" i]',
		'[aria-label*="location" i]',
	]) || cardLines[2] || '';
	return {
		headline,
		company: company || cardLines[1] || '',
		location,
		followed: followControl ? /^(?:following|unfollow)\b/i.test(followLabel || '') : null,
	};
}

function candidateKey(card: HTMLElement, profileUrl: string, name: string): string {
	return card.dataset.urn || card.getAttribute('data-urn') || profileUrl || name.toLowerCase();
}

function isConnectButton(button: HTMLButtonElement): boolean {
	if (button.closest(`.${MANAGER_CLASS}`)) return false;
	return [button.textContent, button.getAttribute('aria-label'), button.getAttribute('title')]
		.some(label => label && CONNECT_LABEL.test(label.replace(/\s+/g, ' ').trim()));
}

function isCandidateCard(element: HTMLElement): boolean {
	return parseMutualCount(candidateText(element)) !== null;
}

function findCandidateCard(button: HTMLButtonElement): ?HTMLElement {
	const knownCard = button.closest(CARD_SELECTOR);
	if (knownCard instanceof HTMLElement && isCandidateCard(knownCard)) return knownCard;

	let element = button.parentElement;
	let fallback = null;
	while (element && element !== document.body) {
		if (isCandidateCard(element)) {
			fallback = element;
			if (element.querySelectorAll('p').length >= 2) return element;
		}
		if (element.matches('main, [role="main"]')) break;
		element = element.parentElement;
	}
	return fallback;
}

export function collectCandidates(root: ParentNode = document): Candidate[] {
	if (!isMyNetwork()) return [];
	const threshold = getThreshold(module.options.mutualThreshold.value);
	const candidates = [];
	const seen = new Set();
	const diagnostics = {
		connectButtons: 0,
		mutualCounts: 0,
		aboveThreshold: 0,
		qualifying: 0,
	};
	for (const element of root.querySelectorAll('button')) {
		if (!(element instanceof HTMLButtonElement) || !isVisible(element) || !isConnectButton(element)) continue;
		diagnostics.connectButtons++;
		const card = findCandidateCard(element);
		if (!card) continue;
		const profile = findProfile(card, element);
		const profileImageUrl = findProfileImage(card);
		const details = findCandidateDetails(card, profile.name);
		const mutualCount = parseMutualCount(candidateText(card));
		if (mutualCount === null) continue;
		diagnostics.mutualCounts++;
		if (!meetsThreshold(mutualCount, threshold)) {
			diagnostics.aboveThreshold++;
			continue;
		}
		if (STATUS_LABEL.test(textOf(element).trim())) continue;
		const key = candidateKey(card, profile.url, profile.name);
		if (seen.has(key)) continue;
		seen.add(key);
		candidates.push({ key, card, button: element, name: profile.name, profileUrl: profile.url, profileImageUrl, ...details, mutualCount });
	}
	diagnostics.qualifying = candidates.length;
	scanDiagnostics = diagnostics;
	const diagnosticSignature = JSON.stringify(diagnostics);
	if (diagnosticSignature !== lastDiagnosticSignature) {
		lastDiagnosticSignature = diagnosticSignature;
		console.debug('[LES Auto-Connect] candidate scan', diagnostics);
	}
	return candidates.sort((a, b) => b.mutualCount - a.mutualCount || a.name.localeCompare(b.name));
}

function mountManager() {
	if (manager && manager.isConnected) return;
	if (!document.body) return;

	manager = string.html`
		<section class="${MANAGER_CLASS}" hidden data-les-ignore="true" aria-label="LES auto-connect queue">
				<header>
					<div>
						<strong>Auto-connect queue</strong>
						<span class="les-auto-connect-summary"></span>
					</div>
					<div class="les-auto-connect-header-actions">
						<button type="button" data-action="toggle" aria-expanded="true">Hide queue</button>
						<button type="button" data-action="refresh">Refresh queue</button>
					</div>
				</header>
				<p class="les-auto-connect-intro">Scroll down a little to load more people. LES will add qualifying potential connections to this queue.</p>
				<div class="les-auto-connect-status" role="status" aria-live="polite"></div>
				<div class="les-auto-connect-list"></div>
				<footer>
					<span class="les-auto-connect-footer-note">Messages can be edited per person.</span>
					<button type="button" data-action="send" class="les-auto-connect-primary">Auto-connect queued</button>
				</footer>
		</section>
	`;
	document.body.append(manager);
	manager.addEventListener('click', handleClick);
	manager.addEventListener('input', handleInput);
}

function render(candidates: Candidate[]) {
	if (!manager) return;
	const list = manager.querySelector('.les-auto-connect-list');
	const summary = manager.querySelector('.les-auto-connect-summary');
	if (!(list instanceof HTMLElement)) return;
	const entries: QueueEntry[] = Array.from(queue.values()).sort((left, right) =>
		right.candidate.mutualCount - left.candidate.mutualCount ||
		left.candidate.name.localeCompare(right.candidate.name),
	);
	const queued = entries.filter(entry => entry.status === 'queued').length;
	const sent = entries.filter(entry => entry.status === 'sent').length;
	const failed = entries.filter(entry => entry.status === 'failed').length;
	const batchSize = getBatchSize(module.options.batchSize.value);
	if (summary) summary.textContent = `${queued} queued · ${sent} sent · ${failed} failed · ${candidates.length} qualifying on this page · up to ${batchSize} per run`;
	list.textContent = '';
	for (const entry of entries) {
		const { candidate } = entry;
		const canEdit = !sending && (entry.status === 'queued' || entry.status === 'failed');
		const primaryAction = entry.status === 'failed' ? 'retry' : 'connect';
		const primaryLabel = entry.status === 'failed' ? 'Retry' : 'Connect now';
		const profileUrl = candidate.profileUrl || (candidate.name !== 'Unknown person' ?
			`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(candidate.name)}` : '');
		const profileTitle = candidate.profileUrl ? 'Open LinkedIn profile' : 'Search LinkedIn for this person';
		const item = string.html`
			<div class="les-auto-connect-item" data-candidate-key="${candidate.key}" data-status="${entry.status}">
				${candidate.profileImageUrl ? string._html`<img class="les-auto-connect-item-avatar" src="${candidate.profileImageUrl}" alt="" aria-hidden="true" />` : ''}
				${profileUrl ? string._html`<a href="${profileUrl}" target="_blank" rel="noreferrer" title="${profileTitle}">${candidate.name}</a>` : string._html`<span class="les-auto-connect-item-name">${candidate.name}</span>`}
				<div class="les-auto-connect-item-details">
					${candidate.headline ? string._html`<span>${candidate.headline}</span>` : ''}
					${candidate.company ? string._html`<span>${candidate.company}</span>` : ''}
					${candidate.location ? string._html`<span>${candidate.location}</span>` : ''}
					${candidate.followed === true ? string._html`<span>Followed</span>` : ''}
					${candidate.followed === false ? string._html`<span>Not followed</span>` : ''}
				</div>
				<div class="les-auto-connect-item-meta">
					<small>${candidate.mutualCount} mutual connections</small>
					<span class="les-auto-connect-item-status">${entry.status}</span>
				</div>
				${entry.error ? string._html`<p class="les-auto-connect-item-error">${entry.error}</p>` : ''}
				<textarea data-message-key="${candidate.key}" rows="2" aria-label="Connection message for ${candidate.name}" ${canEdit ? '' : 'disabled'}></textarea>
				<div class="les-auto-connect-item-actions">
					${canEdit ? string._html`<button type="button" data-action="unqueue" data-candidate-key="${candidate.key}">Remove</button>` : ''}
					${canEdit ? string._html`<button type="button" data-action="${primaryAction}" data-candidate-key="${candidate.key}" class="les-auto-connect-primary">${primaryLabel}</button>` : ''}
				</div>
			</div>
		`;
		const message = item.querySelector('textarea');
		if (message instanceof HTMLTextAreaElement) message.value = entry.message;
		list.append(item);
	}
	const sendButton = manager.querySelector('[data-action="send"]');
	if (sendButton instanceof HTMLButtonElement) {
		sendButton.disabled = sending || queued === 0;
		sendButton.textContent = queued ? `Send queued (${Math.min(queued, batchSize)})` : 'No queued requests';
	}
	if (!entries.length && scanDiagnostics.connectButtons && !scanDiagnostics.mutualCounts) {
		setStatus(`Found ${scanDiagnostics.connectButtons} Connect buttons, but could not read their mutual-connection counts.`);
	} else if (!entries.length && scanDiagnostics.mutualCounts) {
		setStatus(`Read ${scanDiagnostics.mutualCounts} mutual-connection counts; ${scanDiagnostics.aboveThreshold} exceed the current maximum.`);
	} else if (!entries.length) {
		setStatus(candidates.length ? 'Qualifying people will appear here as you scroll.' : 'Scroll down to load My Network results and build the queue.');
	} else if (!sending) {
		setStatus(`${queued} queued · ${sent} sent · ${failed} failed. Failed requests can be retried.`);
	}
}

function setStatus(message: string) {
	if (!manager) return;
	const status = manager.querySelector('.les-auto-connect-status');
	if (status) status.textContent = message;
}

function handleInput(event: Event) {
	if (!(event.target instanceof HTMLTextAreaElement)) return;
	const key = event.target.getAttribute('data-message-key');
	const entry = key ? queue.get(key) : null;
	if (entry) entry.message = event.target.value;
}

function handleClick(event: Event) {
	const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
	if (!(target instanceof HTMLElement)) return;
	const key = target.dataset.candidateKey;
	if (target.dataset.action === 'toggle' && manager) {
		const collapsed = manager.classList.toggle('is-collapsed');
		target.textContent = collapsed ? 'Show queue' : 'Hide queue';
		target.setAttribute('aria-expanded', String(!collapsed));
	} else if (target.dataset.action === 'refresh') {
		scheduleScan(true);
	} else if (target.dataset.action === 'unqueue' && key) {
		queue.delete(key);
		unqueuedKeys.add(key);
		render(currentCandidates);
	} else if (target.dataset.action === 'connect' && key) {
		const entry = queue.get(key);
		if (entry) sendEntries([entry]).catch(() => {});
	} else if (target.dataset.action === 'retry' && key) {
		const entry = queue.get(key);
		if (entry) {
			const refreshed = currentCandidates.find(candidate => candidate.key === key);
			if (refreshed) entry.candidate = refreshed;
			entry.status = 'queued';
			entry.error = '';
			render(currentCandidates);
			sendEntries([entry]).catch(() => {});
		}
	} else if (target.dataset.action === 'send') {
		sendEntries(Array.from(queue.values())).catch(() => {});
	}
}

function waitFor<T>(callback: () => ?T, timeout: number = ACTION_TIMEOUT_MS): Promise<T> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const check = () => {
			const value = callback();
			if (value) return resolve(value);
			if (Date.now() - startedAt >= timeout) return reject(new Error('Timed out waiting for LinkedIn response.'));
			setTimeout(check, 100);
		};
		check();
	});
}

function activeDialogs(): HTMLElement[] {
	return Array.from(document.querySelectorAll('[role="dialog"], .artdeco-modal')).filter(element => (
		element instanceof HTMLElement && !element.closest(`.${MANAGER_CLASS}`) && isVisible(element)
	));
}

function dialogButton(dialog: HTMLElement, pattern: RegExp): ?HTMLButtonElement {
	const buttons = Array.from(dialog.querySelectorAll('button')).filter(button => button instanceof HTMLButtonElement && isVisible(button));
	return buttons.find(button => pattern.test((button.textContent || button.getAttribute('aria-label') || '').trim()));
}

async function sendCandidate(candidate: Candidate, note: string): Promise<void> {
	if (!candidate.card.isConnected || !isVisible(candidate.button)) throw new Error(`${candidate.name} is no longer available.`);
	const before = new Set(activeDialogs());
	candidate.button.click();
	let dialog;
	try {
		dialog = await waitFor(() => activeDialogs().find(item => !before.has(item)) || null);
	} catch (error) {
		if (/pending|invited/i.test(textOf(candidate.card))) return;
		throw error;
	}
	const trimmedNote = note.trim();
	if (trimmedNote) {
		const input = dialog.querySelector('textarea, [contenteditable="true"]');
		if (!(input instanceof HTMLTextAreaElement || input instanceof HTMLElement)) throw new Error(`Could not find the note field for ${candidate.name}.`);
		if (input instanceof HTMLTextAreaElement) input.value = trimmedNote;
		else input.textContent = trimmedNote;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}
	const send = dialogButton(dialog, trimmedNote ? /send|invite/i : /send without|send|invite/i);
	if (!(send instanceof HTMLButtonElement)) throw new Error(`Could not find the send button for ${candidate.name}.`);
	send.click();
	await waitFor(() => /pending|invited/i.test(textOf(candidate.card)) || !candidate.button.isConnected ? true : null);
}

function pacingDelay(): number {
	return MIN_PACING_MS + Math.floor(Math.random() * (MAX_PACING_MS - MIN_PACING_MS + 1));
}

async function sendEntries(entries: QueueEntry[]) {
	if (sending || !manager) return;
	const selected = entries
		.filter(entry => entry.status === 'queued')
		.slice(0, getBatchSize(module.options.batchSize.value));
	if (!selected.length) {
		setStatus('Scroll down to add qualifying people to the queue.');
		return;
	}
	sending = true;
	const sendButton = manager.querySelector('[data-action="send"]');
	if (sendButton instanceof HTMLButtonElement) sendButton.disabled = true;
	for (const [index, entry] of selected.entries()) {
		const { candidate } = entry;
		entry.status = 'sending';
		entry.error = '';
		entry.attempts++;
		setStatus(`Sending ${index + 1} of ${selected.length}: ${candidate.name}`);
		render(currentCandidates);
		try {
			// The requests are intentionally serialized and paced to avoid bursty behavior.
			// eslint-disable-next-line no-await-in-loop
			await sendCandidate(candidate, entry.message);
			entry.status = 'sent';
		} catch (error) {
			entry.status = 'failed';
			entry.error = error && error.message ? error.message : String(error);
		}
		render(currentCandidates);
		if (index < selected.length - 1) {
			// eslint-disable-next-line no-await-in-loop
			await new Promise(resolve => {
				setTimeout(resolve, pacingDelay());
			});
		}
	}
	sending = false;
	if (sendButton instanceof HTMLButtonElement) sendButton.disabled = false;
	currentCandidates = collectCandidates();
	const sentCount = selected.filter(entry => entry.status === 'sent').length;
	const failedCount = selected.filter(entry => entry.status === 'failed').length;
	render(currentCandidates);
	setStatus(`Run complete: ${sentCount} sent · ${failedCount} failed.${failedCount ? ' Use Retry on failed requests.' : ''}`);
}

function queueCandidates(candidates: Candidate[]) {
	const defaultMessage = String(module.options.requestNote.value || '');
	for (const candidate of candidates) {
		if (unqueuedKeys.has(candidate.key)) continue;
		const existing = queue.get(candidate.key);
		if (existing) {
			if (existing.status !== 'sent' && existing.status !== 'sending') existing.candidate = candidate;
			continue;
		}
		queue.set(candidate.key, {
			candidate,
			message: defaultMessage,
			status: 'queued',
			error: '',
			attempts: 0,
		});
	}
}

function removeUnavailableEntries(candidates: Candidate[]) {
	const availableKeys = new Set(candidates.map(candidate => candidate.key));
	for (const [key, entry] of queue.entries()) {
		if (entry.status === 'sent' || entry.status === 'sending') continue;
		if (!entry.candidate.card.isConnected || !availableKeys.has(key)) queue.delete(key);
	}
}

function scheduleScan(reconcileQueue: boolean = false) {
	refreshRequested = refreshRequested || reconcileQueue;
	if (scanTimer) clearTimeout(scanTimer);
	scanTimer = setTimeout(() => {
		scanTimer = undefined;
		mountManager();
		if (!manager) return;
		if (!module.options.enabled.value || !isMyNetwork()) {
			refreshRequested = false;
			manager.hidden = true;
			return;
		}
		if (sending) return;
		const candidates = collectCandidates();
		if (refreshRequested) {
			removeUnavailableEntries(candidates);
			refreshRequested = false;
		}
		queueCandidates(candidates);
		manager.hidden = false;
		render(candidates);
	}, 250);
}

export function startAutoConnect() {
	if (started || !isLinkedInHost()) return;
	if (!document.body) {
		if (!startupScheduled) {
			startupScheduled = true;
			document.addEventListener('DOMContentLoaded', () => {
				startupScheduled = false;
				startAutoConnect();
			}, { once: true });
		}
		return;
	}
	started = true;
	mountManager();
	observer = new MutationObserver(mutations => {
		const pageChanged = mutations.some(({ target }) => {
			const element = target instanceof Element ? target : target.parentElement;
			return !element || !element.closest(`.${MANAGER_CLASS}`);
		});
		if (pageChanged) scheduleScan();
	});
	observer.observe(document.body, { childList: true, subtree: true });
	const resetQueue = () => {
		queue.clear();
		unqueuedKeys.clear();
		scheduleScan();
	};
	window.addEventListener('popstate', resetQueue);
	window.addEventListener('hashchange', resetQueue);
	scheduleScan();
}
