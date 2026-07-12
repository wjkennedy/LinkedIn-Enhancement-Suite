/* @flow */

import { Module } from '../core/module';
import * as Options from '../core/options';
import { getURL } from '../environment';
import { string } from '../utils';
import {
	findGameContainers,
	findFeedPosts,
	findNewsContainers,
	findRightRailFooterContainers,
	getPostInfo,
	isLinkedInHost,
	normalizeText,
} from '../utils/linkedin';

export const module: Module<*> = new Module('lesFeedSanitizer');

type Action = 'hide' | 'collapse' | 'dim' | 'label';
type NetworkScope = 'connections' | 'network';
type FeedLayout = 'native' | 'multi-column';
type Match = {|
	reason: string,
	action: Action,
|};

const PROCESSED = 'lesFeedSanitizerProcessed';
const GAME_PROCESSED = 'lesFeedSanitizerGameProcessed';
const NEWS_PROCESSED = 'lesFeedSanitizerNewsProcessed';
const RAIL_FOOTER_PROCESSED = 'lesFeedSanitizerRailFooterProcessed';
const READ_MORE_PROCESSED = 'lesFeedSanitizerReadMoreProcessed';
const LABEL_CLASS = 'les-feed-sanitizer-label';
const CONTROL_CLASS = 'les-feed-sanitizer-control';
const CONTROL_MODE_CLASS = 'les-feed-sanitizer-control-mode';
const CONTROL_BRAND_CLASS = 'les-feed-sanitizer-brand';
const READING_DENSITY_CLASSES = [
	'les-reading-density-comfortable',
	'les-reading-density-compact',
	'les-reading-density-reader',
];
const FEED_LAYOUT_CLASSES = [
	'les-feed-layout-native',
	'les-feed-layout-multi-column',
];
const PAGE_CONTEXT_CLASSES = [
	'les-page-feed',
	'les-page-network',
];

module.moduleName = 'Feed Sanitizer';
module.category = 'LinkedIn';
module.description = 'Hide, collapse, dim, or label repetitive LinkedIn feed formats.';
module.options = {
	defaultAction: {
		type: 'enum',
		value: 'collapse',
		values: [{
			name: 'Hide',
			value: 'hide',
		}, {
			name: 'Collapse',
			value: 'collapse',
		}, {
			name: 'Dim',
			value: 'dim',
		}, {
			name: 'Label',
			value: 'label',
		}],
		title: 'Default action',
		description: 'Action to apply when a built-in feed rule matches.',
	},
	readingDensity: {
		type: 'enum',
		value: 'comfortable',
		values: [{
			name: 'Comfortable',
			value: 'comfortable',
		}, {
			name: 'Compact',
			value: 'compact',
		}, {
			name: 'Reader',
			value: 'reader',
		}],
		title: 'Reading density',
		description: 'Pack more LinkedIn content onto the screen. Reader mode also reduces side-rail distractions.',
	},
	expandReadMoreInComfortable: {
		type: 'boolean',
		value: false,
		title: 'Auto-expand in comfortable',
		description: 'Automatically expand truncated post text when reading density is set to Comfortable.',
	},
	feedLayout: {
		type: 'enum',
		value: 'native',
		values: [{
			name: 'Native',
			value: 'native',
		}, {
			name: 'Multi-column',
			value: 'multi-column',
		}],
		title: 'Feed layout',
		description: 'Use available screen width to arrange feed posts into responsive columns.',
	},
	filterPromoted: {
		type: 'boolean',
		value: true,
		title: 'Promoted posts',
		description: 'Apply the default action to posts marked as promoted.',
	},
	filterSuggested: {
		type: 'boolean',
		value: true,
		title: 'Suggested posts',
		description: 'Apply the default action to posts marked as suggested.',
	},
	filterPolls: {
		type: 'boolean',
		value: true,
		title: 'Polls',
		description: 'Apply the default action to feed polls.',
	},
	filterEngagementBait: {
		type: 'boolean',
		value: true,
		title: 'Engagement bait',
		description: 'Apply the default action to common engagement-bait phrases.',
	},
	filterOutsideNetwork: {
		type: 'boolean',
		value: false,
		title: 'Only show connections/network',
		description: 'Filter feed posts when the author is outside the selected LinkedIn relationship scope.',
	},
	networkScope: {
		type: 'enum',
		value: 'network',
		values: [{
			name: 'First-degree connections only',
			value: 'connections',
		}, {
			name: 'Connections and network',
			value: 'network',
		}],
		title: 'Allowed relationship scope',
		description: 'Choose whether to allow only 1st-degree connections, or 1st/2nd/3rd-degree network posts.',
		dependsOn: options => options.filterOutsideNetwork.value,
	},
	networkAction: {
		type: 'enum',
		value: 'hide',
		values: [{
			name: 'Hide',
			value: 'hide',
		}, {
			name: 'Collapse',
			value: 'collapse',
		}, {
			name: 'Dim',
			value: 'dim',
		}, {
			name: 'Label',
			value: 'label',
		}],
		title: 'Outside-network action',
		description: 'Action to apply to posts outside the selected relationship scope.',
		dependsOn: options => options.filterOutsideNetwork.value,
	},
	filterGames: {
		type: 'boolean',
		value: true,
		title: 'LinkedIn games',
		description: 'Block LinkedIn game links and cards wherever they appear.',
	},
	gameAction: {
		type: 'enum',
		value: 'hide',
		values: [{
			name: 'Hide',
			value: 'hide',
		}, {
			name: 'Collapse',
			value: 'collapse',
		}, {
			name: 'Dim',
			value: 'dim',
		}, {
			name: 'Label',
			value: 'label',
		}],
		title: 'Game action',
		description: 'Action to apply to LinkedIn game surfaces.',
		dependsOn: options => options.filterGames.value,
	},
	filterNews: {
		type: 'boolean',
		value: true,
		title: 'LinkedIn News',
		description: 'Block LinkedIn News cards and right-rail news modules.',
	},
	newsAction: {
		type: 'enum',
		value: 'hide',
		values: [{
			name: 'Hide',
			value: 'hide',
		}, {
			name: 'Collapse',
			value: 'collapse',
		}, {
			name: 'Dim',
			value: 'dim',
		}, {
			name: 'Label',
			value: 'label',
		}],
		title: 'News action',
		description: 'Action to apply to LinkedIn News surfaces.',
		dependsOn: options => options.filterNews.value,
	},
	phraseRules: {
		type: 'table',
		addRowText: 'Add phrase rule',
		fields: [{
			key: 'phrase',
			name: 'Phrase',
			type: 'text',
		}, {
			key: 'action',
			name: 'Action',
			type: 'enum',
			value: 'collapse',
			values: [{
				name: 'Hide',
				value: 'hide',
			}, {
				name: 'Collapse',
				value: 'collapse',
			}, {
				name: 'Dim',
				value: 'dim',
			}, {
				name: 'Label',
				value: 'label',
			}],
		}],
		value: [],
		title: 'Phrase rules',
		description: 'Case-insensitive phrases to match in feed posts.',
	},
};

module.shouldRun = () => isLinkedInHost();
module.onSaveSettings = changedSettings => {
	if (changedSettings.readingDensity || changedSettings.expandReadMoreInComfortable) {
		applyReadingDensityClass();
		syncControlState();
		refreshReadableContent();
	}
	if (changedSettings.feedLayout) applyFeedLayoutClass();
	applyPageContextClass();
};
module.contentStart = () => {
	applyReadingDensityClass();
	applyFeedLayoutClass();
	applyPageContextClass();
	mountControl();
	scan();
	startObserver();
	scheduleRescans();
};

function applyReadingDensityClass() {
	const density = readingDensityFromOption(module.options.readingDensity.value);

	document.documentElement.classList.remove(...READING_DENSITY_CLASSES);
	document.documentElement.classList.add(`les-reading-density-${density}`);
}

function applyFeedLayoutClass() {
	const layout = feedLayoutFromOption(module.options.feedLayout.value);

	document.documentElement.classList.remove(...FEED_LAYOUT_CLASSES);
	document.documentElement.classList.add(`les-feed-layout-${layout}`);
}

function mountControl() {
	if (document.querySelector(`.${CONTROL_CLASS}`)) return;
	const advertiseItem = findAdvertiseItem();
	if (!advertiseItem || !advertiseItem.parentElement) return;

	const control = string.html`
		<li class="${CONTROL_CLASS}" data-les-ignore="true">
			<a class="${CONTROL_BRAND_CLASS}" href="#les:settings/lesFeedSanitizer/readingDensity" title="LES Settings > Feed Sanitizer > Reading density" aria-label="LES Feed Sanitizer settings">
				<img src="${getURL('images/beta48.png')}" alt="" />
			</a>
			<label class="${CONTROL_MODE_CLASS}">
				<select aria-label="LES reading mode" title="LES reading mode">
					<option value="compact">Compact</option>
					<option value="comfortable">Comfortable</option>
					<option value="reader">Reader</option>
				</select>
			</label>
		</li>
	`;

	const densitySelect = control.querySelector('select');
	if (!(densitySelect instanceof HTMLSelectElement)) return;

	densitySelect.addEventListener('change', () => {
		module.options.readingDensity.value = densitySelect.value;
		Options.save(module.options.readingDensity);
		applyReadingDensityClass();
		syncControlState();
		refreshReadableContent();
	});

	advertiseItem.after(control);
	syncControlState();
}

function syncControlState() {
	const control = document.querySelector(`.${CONTROL_CLASS}`);
	if (!control) return;

	const densitySelect = control.querySelector('select');
	if (!(densitySelect instanceof HTMLSelectElement)) return;

	const density = readingDensityFromOption(module.options.readingDensity.value);
	densitySelect.value = density;
	densitySelect.title = density === 'reader'
		? 'Reader mode expands truncated text automatically.'
		: density === 'comfortable'
			? 'Comfortable mode. Enable auto-expand in LES settings if desired.'
			: 'Compact mode.';
}

function findAdvertiseItem(): ?HTMLElement {
	const advertiseLink = document.querySelector([
		'header a[href*="linkedin.com/campaignmanager/accounts"]',
		'header a[aria-label^="Advertise"]',
	].join(', '));

	return advertiseLink instanceof HTMLElement ? advertiseLink.closest('li') : null;
}

function refreshReadableContent() {
	for (const button of document.querySelectorAll(`[data-${READ_MORE_PROCESSED.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}]`)) {
		if (button instanceof HTMLElement) delete button.dataset[READ_MORE_PROCESSED];
	}

	scan();
	requestAnimationFrame(() => scan());
}

function applyPageContextClass() {
	document.documentElement.classList.remove(...PAGE_CONTEXT_CLASSES);

	if (/^\/mynetwork(?:\/|$)/i.test(location.pathname)) {
		document.documentElement.classList.add('les-page-network');
	} else if (/^\/feed(?:\/|$)/i.test(location.pathname)) {
		document.documentElement.classList.add('les-page-feed');
	}
}

function scan(root?: ParentNode) {
	mountControl();
	expandReadableContent(root || document);

	if (module.options.filterGames.value) {
		for (const container of findGameContainers(root || document)) {
			processGameContainer(container);
		}
	}

	if (module.options.filterNews.value) {
		for (const container of findNewsContainers(root || document)) {
			processNewsContainer(container);
		}
	}

	if (module.options.filterGames.value || module.options.filterNews.value) {
		for (const container of findRightRailFooterContainers(root || document)) {
			processRailFooterContainer(container);
		}
	}

	for (const post of findFeedPosts(root || document)) {
		processPost(post);
	}
}

function startObserver() {
	const target = document.body || document.documentElement;
	if (!target) return;

	const observer = new MutationObserver(records => {
		for (const record of records) {
			if (record.type === 'attributes' && record.target instanceof HTMLElement) {
				scan(record.target);
				continue;
			}

			for (const node of record.addedNodes) {
				if (node instanceof HTMLElement) scan(node);
			}
		}
	});

	observer.observe(target, {
		attributeFilter: ['aria-label', 'href', 'src', 'title'],
		attributes: true,
		childList: true,
		subtree: true,
	});
}

function scheduleRescans() {
	for (const delay of [100, 500, 1500, 3000, 7000]) {
		setTimeout(() => scan(), delay);
	}

	window.addEventListener('focus', () => scan());
	window.addEventListener('popstate', () => {
		applyPageContextClass();
		scan();
	});
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			applyPageContextClass();
			scan();
		}
	});
}

function processGameContainer(container: HTMLElement) {
	if (container.dataset[GAME_PROCESSED]) return;
	container.dataset[GAME_PROCESSED] = 'true';

	applyAction(container, {
		reason: 'LinkedIn games',
		action: actionFromOption(module.options.gameAction.value),
	});
}

function processNewsContainer(container: HTMLElement) {
	if (container.dataset[NEWS_PROCESSED]) return;
	container.dataset[NEWS_PROCESSED] = 'true';

	applyAction(container, {
		reason: 'LinkedIn News',
		action: actionFromOption(module.options.newsAction.value),
	});
}

function processRailFooterContainer(container: HTMLElement) {
	if (container.dataset[RAIL_FOOTER_PROCESSED]) return;
	container.dataset[RAIL_FOOTER_PROCESSED] = 'true';

	applyAction(container, {
		reason: 'LinkedIn footer',
		action: 'hide',
	});
}

function expandReadableContent(root: ParentNode) {
	const density = readingDensityFromOption(module.options.readingDensity.value);
	if (density === 'compact') return;
	if (density === 'comfortable' && !module.options.expandReadMoreInComfortable.value) return;

	for (const button of findReadMoreButtons(root)) {
		if (button.dataset[READ_MORE_PROCESSED]) continue;
		button.dataset[READ_MORE_PROCESSED] = 'true';
		button.click();
	}
}

function findReadMoreButtons(root: ParentNode): HTMLElement[] {
	const buttons = [];
	const selectors = [
		'button',
		'[role="button"]',
		'[aria-label*="more" i]',
		'[data-testid="expandable-text-button"]',
		'[data-testid="expandable-text-button"] span',
		'button[aria-label*="see more" i]',
		'button[aria-label*="show more" i]',
		'button[aria-label*="read more" i]',
		'button[class*="show-more" i]',
		'[role="button"][class*="show-more" i]',
		'button.feed-shared-inline-show-more-text__see-more-less-toggle',
		'button.inline-show-more-text__button',
		'.feed-shared-inline-show-more-text button',
		'.inline-show-more-text button',
		'.feed-shared-inline-show-more-text span',
		'.inline-show-more-text span',
		'.update-components-text span',
		'.feed-shared-text span',
	];
	const seen = new Set();

	for (const selector of selectors) {
		for (const candidate of queryElements(root, selector)) {
			const control = getReadMoreControl(candidate);
			if (!control || seen.has(control) || !isReadMoreButton(control)) continue;
			seen.add(control);
			buttons.push(control);
		}
	}

	return buttons;
}

function getReadMoreControl(candidate: HTMLElement): ?HTMLElement {
	const control = candidate.closest('button, [role="button"], a');
	if (control instanceof HTMLElement && isContentExpansionContext(control)) {
		if (
			control !== candidate &&
			(
				control.dataset.testid === 'expandable-text-button' ||
				control.getAttribute('aria-hidden') === 'true' ||
				window.getComputedStyle(control).pointerEvents === 'none'
			)
		) {
			return candidate;
		}

		return control;
	}

	return candidate;
}

function isReadMoreButton(button: HTMLElement): boolean {
	if (button.closest('[data-les-ignore="true"]')) return false;
	if (button.closest('nav, header, [role="menu"], [role="menubar"], .global-nav')) return false;
	if (button.hasAttribute('disabled')) return false;
	if (button.getAttribute('aria-expanded') === 'true') return false;
	if (button.getAttribute('aria-pressed') === 'true') return false;
	if (button.getAttribute('aria-haspopup')) return false;

	const text = normalizeText([
		button.getAttribute('aria-label') || '',
		button.getAttribute('title') || '',
		button.innerText || button.textContent || '',
	].join(' '));

	if (/\b(?:comments?|replies|reactions?|results|filters?)\b/i.test(text)) return false;
	if (/\b(?:options?|menu|account|profile|jobs?|messages?|notifications?)\b/i.test(text)) return false;
	if (!isContentExpansionContext(button)) return false;

	return /\b(?:see|show|read)\s+more\b/i.test(text) || /^(?:\.{0,3}|\u2026)?\s*more\.?$/i.test(text);
}

function isContentExpansionContext(button: HTMLElement): boolean {
	return !!button.closest([
		'.feed-shared-inline-show-more-text',
		'.inline-show-more-text',
		'.update-components-text',
		'.feed-shared-text',
		'.feed-shared-update-v2__commentary',
		'.mn-connection-card',
		'.mn-pymk-list__card',
		'.mn-community-summary__entity-card',
		'.mn-invitations-preview__invite-card',
		'.artdeco-card',
		'article',
		'[data-urn*="activity"]',
	].join(', '));
}

function processPost(post: HTMLElement) {
	if (post.dataset[PROCESSED]) return;

	const match = classifyPost(post);
	if (!match) return;

	post.dataset[PROCESSED] = 'true';
	applyAction(post, match);
}

function classifyPost(post: HTMLElement): ?Match {
	const info = getPostInfo(post);
	const defaultAction = actionFromOption(module.options.defaultAction.value);

	if (module.options.filterPromoted.value && info.isPromoted) {
		return { reason: 'Promoted', action: defaultAction };
	}

	if (module.options.filterSuggested.value && info.isSuggested) {
		return { reason: 'Suggested', action: defaultAction };
	}

	if (module.options.filterPolls.value && info.hasPoll) {
		return { reason: 'Poll', action: defaultAction };
	}

	if (module.options.filterEngagementBait.value && isEngagementBait(info.text)) {
		return { reason: 'Engagement bait', action: defaultAction };
	}

	if (module.options.filterOutsideNetwork.value && !isAllowedRelationship(info.relationship, networkScopeFromOption(module.options.networkScope.value))) {
		return {
			reason: `Outside selected network (${relationshipLabel(info.relationship)})`,
			action: actionFromOption(module.options.networkAction.value),
		};
	}

	const phraseMatch = matchPhraseRule(info.text);
	if (phraseMatch) return phraseMatch;
}

function isAllowedRelationship(relationship, scope: NetworkScope): boolean {
	if (relationship === 'self') return true;
	if (relationship === 'first') return true;

	if (scope === 'network') {
		return relationship === 'second' || relationship === 'third';
	}

	return false;
}

function relationshipLabel(relationship): string {
	switch (relationship) {
		case 'self':
			return 'you';
		case 'first':
			return '1st';
		case 'second':
			return '2nd';
		case 'third':
			return '3rd';
		default:
			return 'unknown relationship';
	}
}

function matchPhraseRule(text: string): ?Match {
	const lowerText = text.toLowerCase();

	for (const row of module.options.phraseRules.value) {
		const [rawPhrase, rawAction] = row;
		const phrase = normalizeText(String(rawPhrase || '')).toLowerCase();
		if (!phrase || !lowerText.includes(phrase)) continue;

		return {
			reason: `Phrase: ${phrase}`,
			action: actionFromOption(rawAction),
		};
	}
}

function isEngagementBait(text: string): boolean {
	return [
		/\bagree\?/i,
		/\bthoughts\?/i,
		/\bcomment\s+[^.]{0,24}\s+(and|to)\s+(i'?ll|i will|receive|get|send)/i,
		/\bwhat would you add\?/i,
		/\brepost if\b/i,
		/\bhere are \d+ (lessons|things|ways)\b/i,
	].some(pattern => pattern.test(text));
}

function applyAction(post: HTMLElement, { reason, action }: Match) {
	post.classList.add('les-feed-sanitizer-processed');
	post.dataset.lesFeedSanitizerReason = reason;
	post.dataset.lesFeedSanitizerAction = action;
	addLabel(post, reason, action);

	if (action !== 'label') {
		post.classList.add(`les-feed-sanitizer-${action}`);
	}
}

function addLabel(post: HTMLElement, reason: string, action: Action) {
	if (post.querySelector(`.${LABEL_CLASS}`)) return;

	const label = document.createElement('div');
	label.className = LABEL_CLASS;
	label.dataset.lesIgnore = 'true';
	label.textContent = `LES: ${reason} (${action})`;
	post.insertBefore(label, post.firstChild);
}

function actionFromOption(value: mixed): Action {
	if (value === 'hide' || value === 'collapse' || value === 'dim' || value === 'label') {
		return value;
	}

	return 'collapse';
}

function networkScopeFromOption(value: mixed): NetworkScope {
	if (value === 'connections' || value === 'network') return value;
	return 'network';
}

function readingDensityFromOption(value: mixed): 'comfortable' | 'compact' | 'reader' {
	if (value === 'comfortable' || value === 'compact' || value === 'reader') return value;
	return 'comfortable';
}

function feedLayoutFromOption(value: mixed): FeedLayout {
	if (value === 'native' || value === 'multi-column') return value;
	return 'native';
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
