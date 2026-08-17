/* @flow */

import { Module } from '../core/module';
import * as Options from '../core/options';
import { getOptionsURL, openNewTab } from '../environment';
import { addListener } from '../environment/foreground/messaging';
import beta48 from '../../images/beta48.png';
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
const TRANSLATE_PROCESSED = 'lesFeedSanitizerTranslateProcessed';
const AUTO_TRANSLATE_LABEL_CLASS = 'les-auto-translate-label';
const LABEL_CLASS = 'les-feed-sanitizer-label';
const CONTROL_CLASS = 'les-feed-sanitizer-control';
const CONTROL_MODE_CLASS = 'les-feed-sanitizer-control-mode';
const CONTROL_TOGGLE_CLASS = 'les-feed-sanitizer-control-toggle';
const CONTROL_TRANSLATE_CLASS = 'les-feed-sanitizer-control-translate';
const CONTROL_NIGHT_MODE_CLASS = 'les-feed-sanitizer-control-night-mode';
const CONTROL_BRAND_CLASS = 'les-feed-sanitizer-brand';
const CONTROL_VISIBLE_CLASS = 'les-feed-sanitizer-control-visible';
const PRIMARY_HEADER_CLASS = 'les-primary-header-anchor';
const NIGHT_MODE_CLASS = 'les-night-mode';
const READER_HIDDEN_POST_CLASS = 'les-reader-hidden-post';
const READER_LOAD_GATE_CLASS = 'les-reader-load-gate';
const READER_COLUMN_CANVAS_CLASS = 'les-reader-column-canvas';
const READER_COLUMN_RESIZER_CLASS = 'les-reader-column-resizer';
const COMPACT_MEDIA_COLLAPSED_CLASS = 'les-compact-media-collapsed';
const COMPACT_MEDIA_ITEM_CLASS = 'les-compact-media-item';
const READER_PRIMARY_CONTENT_CLASS = 'les-reader-primary-content';
const FEED_COMPOSER_CLASS = 'les-feed-composer';
const NOTIFICATION_BANNER_TEXT = '📫 You’ve been selected to join.';
const READER_BATCH_SIZE = 10;
const READER_COLUMN_MIN_WIDTH = 18;
const SETTINGS_ROUTE_PATTERN = /^\/(?:mypreferences|psettings|settings|privacy)(?:\/|$)/i;
const PRIVACY_REPORT_DEFAULT = 'Probes 0 (unresolved 0) | Deflected 0';
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

let readerVisiblePostCount = READER_BATCH_SIZE;
const extensionProbeURLs = new Set();
let extensionScanObserver: ?PerformanceObserver;
let extensionScanReportingStarted = false;
let mainWorldExtensionProbeCount = 0;
let mainWorldUnresolvedProbeCount = 0;
let privacyProbeDelta = 0;
let privacyUnresolvedProbeDelta = 0;
let privacyDeflectedDelta = 0;
let privacyReportSaveTimer: ?TimeoutID;
let stickySurfaceObserver: ?ResizeObserver;
let stickyHeader: ?HTMLElement;
let stickyControl: ?HTMLElement;
let stickyOffsetFrame: ?number;
let readerLayoutFrame: ?number;
let scanFrame: ?number;
let fullScanPending = false;
let readerLayoutPending = false;
let rootClassObserver: ?MutationObserver;
const pendingScanRoots: Set<HTMLElement> = new Set();
let readableContentObserver: ?IntersectionObserver;
const readableContentActions: WeakMap<HTMLElement, 'expand' | 'translate'> = new WeakMap();

addListener('telemetryDeflected', () => {
	recordPrivacyActivity(0, 0, 1);
});

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
		value: 'compact',
		values: [{
			name: 'Compact',
			value: 'compact',
		}, {
			name: 'Reader',
			value: 'reader',
		}],
		title: 'Reading density',
		description: 'Compact keeps the regular LinkedIn stream. Reader mode expands post text and reveals posts in batches.',
	},
	autoExpand: {
		type: 'boolean',
		value: true,
		title: 'Auto-expand',
		description: 'Automatically expand truncated LinkedIn text in every reading mode.',
	},
	autoTranslate: {
		type: 'boolean',
		value: false,
		title: 'Auto-translate',
		description: 'Automatically translate eligible LinkedIn posts and replies.',
	},
	nightMode: {
		type: 'boolean',
		value: false,
		title: 'Night mode',
		description: 'Use a dark LinkedIn reading surface.',
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
	readerColumnWidths: {
		type: 'text',
		value: '33,34,33',
		title: 'Reader column widths',
		description: 'Relative widths for Reader mode columns. Adjust them by dragging a column divider.',
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
	privacyReport: {
		type: 'text',
		value: PRIVACY_REPORT_DEFAULT,
		title: 'Enhanced privacy',
		description: 'Cumulative browser-extension resource probes observed by LES and LinkedIn telemetry requests deflected by LES. "Unresolved" probes used Chrome\'s invalid extension URL and cannot be attributed to a specific scanner. LES does not retain or transmit probed extension IDs or URLs.',
		advanced: true,
		readOnly: true,
		keywords: ['privacy', 'probes', 'telemetry', 'tracking', 'deflected'],
	},
};

module.shouldRun = () => isLinkedInHost() && !isSettingsRoute();
module.onSaveSettings = changedSettings => {
	if (changedSettings.readingDensity || changedSettings.autoExpand || changedSettings.autoTranslate) {
		applyReadingDensityClass();
		applyReaderColumnWidths();
		syncControlState();
		if (changedSettings.readingDensity) reconcileReaderLayout();
		refreshReadableContent();
	}
	if (changedSettings.feedLayout) applyFeedLayoutClass();
	if (changedSettings.readerColumnWidths) applyReaderColumnWidths();
	if (changedSettings.nightMode) {
		applyNightModeClass();
		syncControlState();
	}
	applyPageContextClass();
};
module.contentStart = () => {
	if (isSettingsRoute()) return;
	applyReadingDensityClass();
	applyFeedLayoutClass();
	applyReaderColumnWidths();
	applyNightModeClass();
	applyPageContextClass();
	mountControl();
	setupControlHotkeys();
	startExtensionScanReporting();
	scan();
	startObserver();
	startRootClassObserver();
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

function applyReaderColumnWidths() {
	const [first, second, third] = readerColumnWidthsFromOption(module.options.readerColumnWidths.value);
	const root = document.documentElement;
	root.style.setProperty('--les-reader-column-one', `${first}fr`);
	root.style.setProperty('--les-reader-column-two', `${second}fr`);
	root.style.setProperty('--les-reader-column-three', `${third}fr`);
	root.style.setProperty('--les-reader-divider-one', `${first}%`);
	root.style.setProperty('--les-reader-divider-two', `${first + second}%`);
}

function applyNightModeClass() {
	document.documentElement.classList.toggle(NIGHT_MODE_CLASS, !isSettingsRoute() && module.options.nightMode.value);
}

function isSettingsRoute(): boolean {
	return SETTINGS_ROUTE_PATTERN.test(location.pathname);
}

function mountControl() {
	if (isSettingsRoute()) return;
	const header = findPrimaryHeader();
	if (!(header instanceof HTMLElement)) return;
	for (const oldHeader of document.querySelectorAll(`.${PRIMARY_HEADER_CLASS}`)) {
		if (oldHeader !== header) oldHeader.classList.remove(PRIMARY_HEADER_CLASS);
	}
	header.classList.add(PRIMARY_HEADER_CLASS);

	const existing = document.querySelector(`.${CONTROL_CLASS}`);
	if (existing instanceof HTMLElement) {
		if (existing.previousElementSibling === header) {
			bindStickySurfaces(header, existing);
			return;
		}
		existing.remove();
	}

	const control = string.html`
		<div class="${CONTROL_CLASS}" data-les-ignore="true">
			<a class="${CONTROL_BRAND_CLASS}" href="${getOptionsURL('#les:settings/lesFeedSanitizer').href}" title="LES Settings > Feed Sanitizer" aria-label="LES Feed Sanitizer settings">
				<img src="${beta48}" alt="" />
			</a>
			<label class="${CONTROL_MODE_CLASS}">
				<select aria-label="LES reading mode" title="LES reading mode">
					<option value="compact">Compact</option>
					<option value="reader">Reader</option>
				</select>
			</label>
			<label class="${CONTROL_TOGGLE_CLASS}" title="Auto-expand truncated LinkedIn text">
				<input type="checkbox" aria-label="Auto-expand truncated LinkedIn text" />
				<span>Expand</span>
			</label>
			<label class="${CONTROL_TRANSLATE_CLASS}" title="Auto-translate LinkedIn posts and replies">
				<input type="checkbox" aria-label="Auto-translate LinkedIn posts and replies" />
				<span>Translate</span>
			</label>
			<label class="${CONTROL_NIGHT_MODE_CLASS}" title="Night mode">
				<input type="checkbox" aria-label="Night mode" />
				<span aria-hidden="true"></span>
				<span class="les-feed-sanitizer-night-mode-icon" aria-hidden="true">&#127769;</span>
			</label>
		</div>
	`;

	const densitySelect = control.querySelector('select');
	const settingsLink = control.querySelector(`.${CONTROL_BRAND_CLASS}`);
	const expandToggle = control.querySelector('input[type="checkbox"]');
	const translateToggle = control.querySelector(`.${CONTROL_TRANSLATE_CLASS} input`);
	const nightModeToggle = control.querySelector(`.${CONTROL_NIGHT_MODE_CLASS} input`);
	if (!(densitySelect instanceof HTMLSelectElement) || !(settingsLink instanceof HTMLAnchorElement) || !(expandToggle instanceof HTMLInputElement) || !(translateToggle instanceof HTMLInputElement) || !(nightModeToggle instanceof HTMLInputElement)) return;

	settingsLink.addEventListener('click', event => {
		event.preventDefault();
		openNewTab(settingsLink.href);
	});
	densitySelect.addEventListener('change', () => {
		setReadingDensity(densitySelect.value);
	});

	translateToggle.addEventListener('change', () => {
		module.options.autoTranslate.value = translateToggle.checked;
		saveOption('autoTranslate');
		syncControlState();
		refreshReadableContent();
	});

	nightModeToggle.addEventListener('change', () => {
		module.options.nightMode.value = nightModeToggle.checked;
		saveOption('nightMode');
		applyNightModeClass();
		syncControlState();
	});

	expandToggle.addEventListener('change', () => {
		module.options.autoExpand.value = expandToggle.checked;
		saveOption('autoExpand');
		syncControlState();
		refreshReadableContent();
	});

	header.after(control);
	bindStickySurfaces(header, control);
	syncControlState();
}

function findPrimaryHeader(): ?HTMLElement {
	const primaryNav = document.querySelector('header [data-testid="primary-nav"]');
	const primaryHeader = primaryNav && primaryNav.closest('header');
	if (primaryHeader instanceof HTMLElement) return primaryHeader;

	const linkedInHeader = Array.from(document.querySelectorAll('header')).find(candidate => (
		candidate.querySelector('nav') &&
		candidate.querySelector('a[href*="/feed"], a[href*="/mynetwork"], [aria-label*="LinkedIn" i]')
	));
	return linkedInHeader instanceof HTMLElement ? linkedInHeader : null;
}

function bindStickySurfaces(header: HTMLElement, control: HTMLElement) {
	if (stickyHeader === header && stickyControl === control) return;

	if (!stickySurfaceObserver && typeof ResizeObserver !== 'undefined') {
		stickySurfaceObserver = new ResizeObserver(() => scheduleStickyOffsetUpdate());
	}
	if (stickyHeader) stickySurfaceObserver?.unobserve(stickyHeader);
	if (stickyControl) stickySurfaceObserver?.unobserve(stickyControl);
	stickyHeader = header;
	stickyControl = control;
	stickySurfaceObserver?.observe(header);
	stickySurfaceObserver?.observe(control);
	scheduleStickyOffsetUpdate();
}

function scheduleStickyOffsetUpdate() {
	if (stickyOffsetFrame) return;
	stickyOffsetFrame = requestAnimationFrame(() => {
		stickyOffsetFrame = undefined;
		updateStickyOffsets();
	});
}

function updateStickyOffsets() {
	const header = stickyHeader;
	const control = stickyControl;
	if (!(header instanceof HTMLElement) || !(control instanceof HTMLElement)) return;

	const headerHeight = Math.ceil(header.getBoundingClientRect().height);
	const controlHeight = Math.ceil(control.getBoundingClientRect().height);
	const root = document.documentElement;
	const nextHeaderHeight = `${headerHeight}px`;
	const nextControlHeight = `${controlHeight}px`;
	if (root.style.getPropertyValue('--les-primary-header-height') !== nextHeaderHeight) {
		root.style.setProperty('--les-primary-header-height', nextHeaderHeight);
	}
	if (root.style.getPropertyValue('--les-control-row-height') !== nextControlHeight) {
		root.style.setProperty('--les-control-row-height', nextControlHeight);
	}
}

function setReadingDensity(value: mixed) {
	const density = readingDensityFromOption(value);
	if (module.options.readingDensity.value === density) return;

	module.options.readingDensity.value = density;
	saveOption('readingDensity');
	applyReadingDensityClass();
	applyReaderColumnWidths();
	syncControlState();
	reconcileReaderLayout();
	refreshReadableContent();
}

function setupControlHotkeys() {
	if (document.documentElement.dataset.lesFeedSanitizerHotkeys) return;
	document.documentElement.dataset.lesFeedSanitizerHotkeys = 'true';

	document.addEventListener('keydown', event => {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target?.isContentEditable) return;

		if (event.key.toLowerCase() === 'x' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
			if (toggleCompactMediaCollapse()) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}

		if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;

		if (event.key.toLowerCase() === 'l') {
			event.preventDefault();
			toggleControlVisibility();
			return;
		}

		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		setReadingDensity(event.key === 'ArrowLeft' ? 'compact' : 'reader');
		showControl();
	}, true);
}

function toggleCompactMediaCollapse(): boolean {
	if (readingDensityFromOption(module.options.readingDensity.value) !== 'compact') return false;

	document.documentElement.classList.toggle(COMPACT_MEDIA_COLLAPSED_CLASS);
	applyCompactMediaCollapse(document);
	return true;
}

function applyCompactMediaCollapse(root: ParentNode) {
	if (!document.documentElement.classList.contains(COMPACT_MEDIA_COLLAPSED_CLASS)) return;

	for (const media of queryElements(root, 'img, video, iframe, figure')) {
		if (media.closest('[data-les-ignore="true"]')) continue;
		const image = media.tagName === 'IMG' ? media : media.querySelector('img');
		if (image instanceof HTMLImageElement && isIdentityImage(image)) continue;

		const post = media.closest('div[data-urn*="activity"], div.feed-shared-update-v2, article');
		if (post) media.classList.add(COMPACT_MEDIA_ITEM_CLASS);
	}
}

function isIdentityImage(image: HTMLImageElement): boolean {
	return /(?:profile-displayphoto|profile-framedphoto|company-logo)/i.test(image.currentSrc || image.src) ||
		/(?:profile picture|avatar|company logo)\b/i.test([
			image.alt,
			image.closest('[aria-label]')?.getAttribute('aria-label') || '',
		].join(' '));
}

function toggleControlVisibility() {
	mountControl();
	document.querySelector(`.${CONTROL_CLASS}`)?.classList.toggle(CONTROL_VISIBLE_CLASS);
}

function showControl() {
	mountControl();
	document.querySelector(`.${CONTROL_CLASS}`)?.classList.add(CONTROL_VISIBLE_CLASS);
}

function syncControlState() {
	const control = document.querySelector(`.${CONTROL_CLASS}`);
	if (!control) return;

	const densitySelect = control.querySelector('select');
	const expandToggle = control.querySelector('input[type="checkbox"]');
	const translateToggle = control.querySelector(`.${CONTROL_TRANSLATE_CLASS} input`);
	const nightModeToggle = control.querySelector(`.${CONTROL_NIGHT_MODE_CLASS} input`);
	if (!(densitySelect instanceof HTMLSelectElement) || !(expandToggle instanceof HTMLInputElement) || !(translateToggle instanceof HTMLInputElement) || !(nightModeToggle instanceof HTMLInputElement)) return;

	const density = readingDensityFromOption(module.options.readingDensity.value);
	densitySelect.value = density;
	densitySelect.title = density === 'reader' ?
		'Reader mode reveals feed posts in batches.' :
		'Compact mode.';
	expandToggle.checked = module.options.autoExpand.value;
	translateToggle.checked = module.options.autoTranslate.value;
	nightModeToggle.checked = module.options.nightMode.value;
	control.setAttribute('title', 'Ctrl+Shift+L: show LES controls. Ctrl+Shift+Left/Right: switch reading mode.');
}

function startExtensionScanReporting() {
	if (extensionScanReportingStarted) return;
	extensionScanReportingStarted = true;

	document.addEventListener('les-extension-probe', reportMainWorldExtensionProbes);
	reportMainWorldExtensionProbes();
	if (document.documentElement.hasAttribute('data-les-extension-probe-count')) return;
	if (typeof PerformanceObserver === 'undefined') return;
	for (const entry of performance.getEntriesByType('resource')) reportExtensionProbe(entry.name);

	extensionScanObserver = new PerformanceObserver(entries => {
		for (const entry of entries.getEntries()) reportExtensionProbe(entry.name);
	});
	extensionScanObserver.observe({ entryTypes: ['resource'] });
}

function reportMainWorldExtensionProbes() {
	const count = Number(document.documentElement.getAttribute('data-les-extension-probe-count')) || 0;
	const delta = count - mainWorldExtensionProbeCount;
	if (delta <= 0) return;
	const unresolvedCount = Number(document.documentElement.getAttribute('data-les-extension-probe-unresolved-count')) || 0;
	const unresolvedDelta = Math.max(0, unresolvedCount - mainWorldUnresolvedProbeCount);
	mainWorldExtensionProbeCount = count;
	mainWorldUnresolvedProbeCount = unresolvedCount;
	recordPrivacyActivity(delta, unresolvedDelta, 0);
}

function reportExtensionProbe(url: string) {
	if (/^chrome-extension:\/\/invalid\//i.test(url)) {
		recordPrivacyActivity(1, 1, 0);
		return;
	}
	if (!/^chrome-extension:\/\/[a-p]{32}\//i.test(url) || extensionProbeURLs.has(url)) return;
	extensionProbeURLs.add(url);
	recordPrivacyActivity(1, 0, 0);
}

function recordPrivacyActivity(probes: number, unresolvedProbes: number, deflected: number) {
	privacyProbeDelta += probes;
	privacyUnresolvedProbeDelta += unresolvedProbes;
	privacyDeflectedDelta += deflected;
	if (privacyReportSaveTimer) return;
	privacyReportSaveTimer = setTimeout(flushPrivacyReport, 1000);
}

async function flushPrivacyReport() {
	privacyReportSaveTimer = undefined;
	const probeDelta = privacyProbeDelta;
	const unresolvedProbeDelta = privacyUnresolvedProbeDelta;
	const deflectedDelta = privacyDeflectedDelta;
	privacyProbeDelta = 0;
	privacyUnresolvedProbeDelta = 0;
	privacyDeflectedDelta = 0;
	const storedReport = await Options.getValue(module.moduleID, 'privacyReport').catch(() => undefined);
	const [probes, unresolvedProbes, deflected] = parsePrivacyReport(storedReport || module.options.privacyReport.value);
	const nextReport = formatPrivacyReport(
		probes + probeDelta,
		unresolvedProbes + unresolvedProbeDelta,
		deflected + deflectedDelta,
	);
	module.options.privacyReport.value = nextReport;
	await Options.set(module.moduleID, 'privacyReport', nextReport).catch(() => undefined);
	if (privacyProbeDelta || privacyUnresolvedProbeDelta || privacyDeflectedDelta) {
		privacyReportSaveTimer = setTimeout(flushPrivacyReport, 1000);
	}
}

function parsePrivacyReport(value: mixed): [number, number, number] {
	const match = String(value || '').match(/^Probes (\d+) \(unresolved (\d+)\) \| Deflected (\d+)$/);
	if (!match) return [0, 0, 0];
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function formatPrivacyReport(probes: number, unresolvedProbes: number, deflected: number): string {
	return `Probes ${probes} (unresolved ${unresolvedProbes}) | Deflected ${deflected}`;
}

function refreshReadableContent() {
	if (readableContentObserver) {
		for (const button of document.querySelectorAll([
			READ_MORE_PROCESSED,
			TRANSLATE_PROCESSED,
		].map(key => `[data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}]`).join(', '))) {
			readableContentObserver.unobserve(button);
		}
	}
	for (const button of document.querySelectorAll([
		READ_MORE_PROCESSED,
		TRANSLATE_PROCESSED,
	].map(key => `[data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}]`).join(', '))) {
		if (button instanceof HTMLElement) delete button.dataset[READ_MORE_PROCESSED];
		if (button instanceof HTMLElement) delete button.dataset[TRANSLATE_PROCESSED];
	}

	scheduleScan();
}

function applyPageContextClass() {
	document.documentElement.classList.remove(...PAGE_CONTEXT_CLASSES);

	if (/^\/mynetwork(?:\/|$)/i.test(location.pathname)) {
		document.documentElement.classList.add('les-page-network');
	} else if (/^\/feed(?:\/|$)/i.test(location.pathname)) {
		document.documentElement.classList.add('les-page-feed');
	}
}

function isReadingSurface(): boolean {
	return /^\/(?:feed|mynetwork)(?:\/|$)/i.test(location.pathname);
}

function scan(root?: ParentNode, updateReaderLayout: boolean = true) {
	if (root instanceof HTMLElement && root.closest('[data-les-ignore="true"]')) return;

	if (!root || updateReaderLayout) {
		applyPageContextClass();
		mountControl();
		applyReaderPrimaryContentClass();
		positionFeedComposer();
		mountReaderColumnResizers();
	}
	removeNotificationBanners(root || document);
	applyCompactMediaCollapse(root || document);
	expandReadableContent(root || document);

	if (module.options.filterGames.value) {
		removePatchesPromo(root || document);
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

	const feedPosts = findFeedPosts(root || document);
	for (const post of feedPosts) {
		processPost(post);
	}

	if (updateReaderLayout) {
		const readerPosts = findReaderPosts(feedPosts);
		updateReaderLoadGate(readerPosts);
	}
}

function applyReaderPrimaryContentClass() {
	const enabled = readingDensityFromOption(module.options.readingDensity.value) === 'reader' && /^\/feed(?:\/|$)/i.test(location.pathname);
	for (const section of document.querySelectorAll('section[aria-label="Primary content"]')) {
		section.classList.toggle(READER_PRIMARY_CONTENT_CLASS, enabled);
	}
}

function mountReaderColumnResizers() {
	const isReaderFeed = readingDensityFromOption(module.options.readingDensity.value) === 'reader' && /^\/feed(?:\/|$)/i.test(location.pathname);
	const canvas = document.querySelector('.les-page-feed .scaffold-finite-scroll__content');
	if (!(canvas instanceof HTMLElement)) return;

	canvas.classList.toggle(READER_COLUMN_CANVAS_CLASS, isReaderFeed);
	if (!isReaderFeed) {
		canvas.querySelectorAll(`.${READER_COLUMN_RESIZER_CLASS}`).forEach(handle => handle.remove());
		return;
	}

	for (const index of [0, 1]) {
		let handle = canvas.querySelector(`.${READER_COLUMN_RESIZER_CLASS}[data-column-divider="${index}"]`);
		if (!(handle instanceof HTMLElement)) {
			handle = string.html`<button class="${READER_COLUMN_RESIZER_CLASS}" type="button" data-les-ignore="true" data-column-divider="${index}" aria-label="Resize Reader columns" title="Drag to resize Reader columns"></button>`;
			canvas.append(handle);
		}
		bindReaderColumnResizer(handle, index);
	}
}

function bindReaderColumnResizer(handle: HTMLElement, divider: number) {
	if (handle.dataset.lesReaderResizerBound) return;
	handle.dataset.lesReaderResizerBound = 'true';

	handle.addEventListener('pointerdown', event => {
		if (!(event instanceof PointerEvent)) return;
		event.preventDefault();
		handle.setPointerCapture(event.pointerId);

		const canvas = handle.closest(`.${READER_COLUMN_CANVAS_CLASS}`);
		if (!(canvas instanceof HTMLElement)) return;

		const update = pointerEvent => {
			const rect = canvas.getBoundingClientRect();
			if (!rect.width) return;
			const boundary = Math.max(0, Math.min(100, ((pointerEvent.clientX - rect.left) / rect.width) * 100));
			setReaderColumnBoundary(divider, boundary, false);
		};
		const finish = pointerEvent => {
			update(pointerEvent);
			saveOption('readerColumnWidths');
			if (handle.hasPointerCapture(pointerEvent.pointerId)) handle.releasePointerCapture(pointerEvent.pointerId);
			handle.removeEventListener('pointermove', update);
			handle.removeEventListener('pointerup', finish);
			handle.removeEventListener('pointercancel', finish);
		};

		handle.addEventListener('pointermove', update);
		handle.addEventListener('pointerup', finish);
		handle.addEventListener('pointercancel', finish);
	});
}

function setReaderColumnBoundary(divider: number, boundary: number, save: boolean = true) {
	const widths = readerColumnWidthsFromOption(module.options.readerColumnWidths.value);
	let next;
	if (divider === 0) {
		const first = clamp(boundary, READER_COLUMN_MIN_WIDTH, 100 - (READER_COLUMN_MIN_WIDTH * 2));
		const remaining = 100 - first;
		const ratio = widths[1] / (widths[1] + widths[2]);
		next = [first, remaining * ratio, remaining * (1 - ratio)];
	} else {
		const third = 100 - clamp(boundary, READER_COLUMN_MIN_WIDTH * 2, 100 - READER_COLUMN_MIN_WIDTH);
		const remaining = 100 - third;
		const ratio = widths[0] / (widths[0] + widths[1]);
		next = [remaining * ratio, remaining * (1 - ratio), third];
	}

	module.options.readerColumnWidths.value = next.map(width => width.toFixed(2)).join(',');
	applyReaderColumnWidths();
	if (save) saveOption('readerColumnWidths');
}

function saveOption(key: string) {
	const option = module.options[key];
	if (!option || option.value === undefined) return;
	Options.set(module.moduleID, key, option.value);
}

function positionFeedComposer() {
	if (!/^\/feed(?:\/|$)/i.test(location.pathname)) return;

	const startPostControl = queryElements(document, [
		'button[aria-label*="start a post" i]',
		'[role="button"][aria-label*="start a post" i]',
		'button[title*="start a post" i]',
		'[role="button"][title*="start a post" i]',
	].join(', '))[0] || queryElements(document, 'button, [role="button"]').find(control =>
		/^start\s+a\s+post\b/i.test(normalizeText([
			control.getAttribute('aria-label') || '',
			control.getAttribute('title') || '',
			control.textContent || '',
		].join(' '))),
	);
	if (!startPostControl) return;

	const feed = startPostControl.closest('.scaffold-finite-scroll__content');
	if (!(feed instanceof HTMLElement)) return;

	let composer = startPostControl;
	while (composer.parentElement && composer.parentElement !== feed) composer = composer.parentElement;
	if (composer.parentElement === feed) composer.classList.add(FEED_COMPOSER_CLASS);
}

function updateReaderLoadGate(readerPosts?: HTMLElement[]) {
	if (!isReaderFeed()) {
		for (const post of document.querySelectorAll(`.${READER_HIDDEN_POST_CLASS}`)) {
			post.classList.remove(READER_HIDDEN_POST_CLASS);
		}
		document.querySelector(`.${READER_LOAD_GATE_CLASS}`)?.remove();
		readerVisiblePostCount = READER_BATCH_SIZE;
		return;
	}

	const posts = readerPosts || findReaderPosts();
	const managedPosts = new Set(posts);
	for (const post of document.querySelectorAll(`.${READER_HIDDEN_POST_CLASS}`)) {
		if (post instanceof HTMLElement && !managedPosts.has(post)) post.classList.remove(READER_HIDDEN_POST_CLASS);
	}
	for (const [index, post] of posts.entries()) {
		post.classList.toggle(READER_HIDDEN_POST_CLASS, index >= readerVisiblePostCount);
	}

	const lastVisiblePost = posts[Math.min(readerVisiblePostCount, posts.length) - 1];
	if (!lastVisiblePost) return;

	const gate = getReaderLoadGate();
	const firstHiddenPost = posts[readerVisiblePostCount];
	if (firstHiddenPost && gate.nextElementSibling !== firstHiddenPost) firstHiddenPost.before(gate);
	else if (!firstHiddenPost && gate.previousElementSibling !== lastVisiblePost) lastVisiblePost.after(gate);
}

function reconcileReaderLayout() {
	applyReaderPrimaryContentClass();
	positionFeedComposer();
	mountReaderColumnResizers();
	const readerPosts = isReaderFeed() ? findReaderPosts() : undefined;
	updateReaderLoadGate(readerPosts);
}

function scheduleReaderLayoutReconcile() {
	if (readerLayoutFrame) return;
	readerLayoutFrame = requestAnimationFrame(() => {
		readerLayoutFrame = undefined;
		reconcileReaderLayout();
	});
}

function isReaderFeed(): boolean {
	return readingDensityFromOption(module.options.readingDensity.value) === 'reader' && /^\/feed(?:\/|$)/i.test(location.pathname);
}

function findReaderPosts(feedPosts?: HTMLElement[]): HTMLElement[] {
	return (feedPosts || findFeedPosts(document)).filter(post => !post.parentElement?.closest([
		'div[data-urn*="activity"]',
		'div.feed-shared-update-v2',
		'article',
	].join(', ')));
}

function getReaderLoadGate(): HTMLElement {
	const existing = document.querySelector(`.${READER_LOAD_GATE_CLASS}`);
	if (existing instanceof HTMLElement) return existing;

	const gate = string.html`
		<div class="${READER_LOAD_GATE_CLASS}" data-les-ignore="true">
			<button type="button">Load next 10</button>
		</div>
	`;
	const button = gate.querySelector('button');
	if (button instanceof HTMLButtonElement) {
		button.addEventListener('click', () => {
			readerVisiblePostCount += READER_BATCH_SIZE;
			updateReaderLoadGate();
			requestAnimationFrame(() => updateReaderLoadGate());
		});
	}

	return gate;
}

function startObserver() {
	const target = document.body || document.documentElement;
	if (!target) return;

	const observer = new MutationObserver(records => {
		const hadCurrentPageContext = hasCurrentPageContext();
		applyPageContextClass();
		if (!hadCurrentPageContext) scheduleReaderLayoutReconcile();

		const roots: Set<HTMLElement> = new Set();
		const canvas = document.querySelector(`.${READER_COLUMN_CANVAS_CLASS}`);
		const needsReaderShell = isReaderFeed() && !canvas;
		let layoutChanged = false;
		let readerShellAdded = false;

		for (const record of records) {
			if (record.target instanceof HTMLElement && record.target.closest('[data-les-ignore="true"]')) continue;
			const changedElements = [
				...record.addedNodes,
				...record.removedNodes,
			].filter(node => node instanceof HTMLElement);
			if (
				changedElements.length &&
				changedElements.every(node => (
					node instanceof HTMLElement &&
					(node.matches('[data-les-ignore="true"]') || node.closest('[data-les-ignore="true"]'))
				))
			) continue;

			const recordTarget = record.target instanceof HTMLElement ? record.target : null;
			if (canvas && record.target === canvas) layoutChanged = true;
			for (const node of changedElements) {
				if (!(node instanceof HTMLElement)) continue;
				if (
					needsReaderShell &&
					(
						node.matches('.scaffold-finite-scroll__content') ||
						node.querySelector('.scaffold-finite-scroll__content')
					)
				) {
					readerShellAdded = true;
				}
				if (canvas && (node.parentElement === canvas || node.contains(canvas))) {
					layoutChanged = true;
				}
				if (node.isConnected) roots.add(node);
			}
			if (!changedElements.length && recordTarget) roots.add(recordTarget);
		}

		if ((readerShellAdded || layoutChanged) && isReaderFeed()) scheduleReaderLayoutReconcile();
		for (const root of roots) {
			scheduleScan(root);
		}
	});

	observer.observe(target, {
		attributeFilter: ['aria-label'],
		attributes: true,
		childList: true,
		subtree: true,
	});
}

function startRootClassObserver() {
	if (rootClassObserver) return;
	rootClassObserver = new MutationObserver(() => {
		if (hasManagedRootClasses()) return;

		applyReadingDensityClass();
		applyFeedLayoutClass();
		applyNightModeClass();
		applyPageContextClass();
		applyReaderColumnWidths();
		scheduleReaderLayoutReconcile();
		scheduleScan();
	});
	rootClassObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class'],
	});
}

function hasCurrentPageContext(): boolean {
	const root = document.documentElement;
	const expectedContext = /^\/mynetwork(?:\/|$)/i.test(location.pathname) ? 'les-page-network' :
		/^\/feed(?:\/|$)/i.test(location.pathname) ? 'les-page-feed' : null;
	return !expectedContext || root.classList.contains(expectedContext);
}

function hasManagedRootClasses(): boolean {
	const root = document.documentElement;
	const density = `les-reading-density-${readingDensityFromOption(module.options.readingDensity.value)}`;
	const layout = `les-feed-layout-${feedLayoutFromOption(module.options.feedLayout.value)}`;
	const nightMode = !isSettingsRoute() && module.options.nightMode.value;
	return root.classList.contains(density) &&
		root.classList.contains(layout) &&
		root.classList.contains(NIGHT_MODE_CLASS) === nightMode &&
		hasCurrentPageContext();
}

function scheduleScan(root?: ?HTMLElement, updateReaderLayout: boolean = false) {
	if (root) {
		if (!root.closest('[data-les-ignore="true"]')) pendingScanRoots.add(root);
	} else {
		fullScanPending = true;
	}
	readerLayoutPending = readerLayoutPending || updateReaderLayout;
	if (scanFrame) return;
	const run = () => {
		scanFrame = undefined;
		const scanEverything = fullScanPending;
		const updateLayout = readerLayoutPending;
		const roots = Array.from(pendingScanRoots);
		fullScanPending = false;
		readerLayoutPending = false;
		pendingScanRoots.clear();

		if (scanEverything) {
			scan();
			return;
		}

		for (const root of roots) {
			if (!root.isConnected) continue;
			if (roots.some(candidate => candidate !== root && candidate.contains(root))) continue;
			scan(root, false);
		}
		if (updateLayout) {
			const readerPosts = findReaderPosts();
			updateReaderLoadGate(readerPosts);
		}
	};
	if (typeof window.requestIdleCallback === 'function') {
		scanFrame = window.requestIdleCallback(run, { timeout: 250 });
	} else {
		scanFrame = setTimeout(run, 50);
	}
}

function scheduleRescans() {
	for (const delay of [100, 500, 1500, 3000, 7000]) {
		setTimeout(scheduleScan, delay);
	}

	window.addEventListener('focus', scheduleScan);
	window.addEventListener('popstate', () => {
		applyPageContextClass();
		scheduleScan();
	});
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			applyPageContextClass();
			scheduleScan();
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

function removePatchesPromo(root: ParentNode = document) {
	const promo = root.querySelector('a[href*="/games/patches/"]');
	if (promo instanceof HTMLAnchorElement) promo.remove();
}

function removeNotificationBanners(root: ParentNode = document) {
	const containers = new Set<HTMLElement>();

	for (const element of Array.from(root.querySelectorAll('p, span, div'))) {
		if (!(element instanceof HTMLElement)) continue;

		const text = normalizeText(element.innerText || element.textContent || '');
		if (text !== NOTIFICATION_BANNER_TEXT) continue;

		const container = element.closest('section') || element.parentElement;
		if (container instanceof HTMLElement) containers.add(container);
	}

	for (const container of containers) container.remove();
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
	if (module.options.autoExpand.value && isReadingSurface()) {
		for (const button of findReadMoreButtons(root)) {
			if (button.dataset[READ_MORE_PROCESSED]) continue;
			button.dataset[READ_MORE_PROCESSED] = 'true';
			activateReadableContent(button, 'expand');
		}
	}

	if (module.options.autoTranslate.value) {
		for (const button of findTranslateButtons(root)) {
			if (button.dataset[TRANSLATE_PROCESSED]) continue;
			button.dataset[TRANSLATE_PROCESSED] = 'true';
			activateReadableContent(button, 'translate');
		}
	}
}

function activateReadableContent(button: HTMLElement, action: 'expand' | 'translate') {
	if (!isReaderFeed() || typeof IntersectionObserver === 'undefined') {
		performReadableContentAction(button, action);
		return;
	}

	readableContentActions.set(button, action);
	getReadableContentObserver().observe(button);
}

function getReadableContentObserver(): IntersectionObserver {
	if (!readableContentObserver) {
		readableContentObserver = new IntersectionObserver(entries => {
			for (const entry of entries) {
				if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
				const button = entry.target;
				const action = readableContentActions.get(button);
				readableContentObserver?.unobserve(button);
				readableContentActions.delete(button);
				if (!action) continue;

				const enabled = action === 'expand' ?
					module.options.autoExpand.value :
					module.options.autoTranslate.value;
				if (enabled) {
					performReadableContentAction(button, action);
				} else {
					delete button.dataset[action === 'expand' ? READ_MORE_PROCESSED : TRANSLATE_PROCESSED];
				}
			}
		}, { rootMargin: '1200px 0px' });
	}
	return readableContentObserver;
}

function performReadableContentAction(button: HTMLElement, action: 'expand' | 'translate') {
	if (action === 'translate') labelAutomaticTranslation(button);
	activateReadMoreButton(button);
}

function labelAutomaticTranslation(button: HTMLElement) {
	const container = button.parentElement;
	if (!container || container.querySelector(`.${AUTO_TRANSLATE_LABEL_CLASS}`)) return;

	const label = string.html`<span class="${AUTO_TRANSLATE_LABEL_CLASS}" data-les-ignore="true">auto-t7d</span>`;
	container.append(label);
}

function activateReadMoreButton(button: HTMLElement) {
	const pointerTarget = button.matches('[data-testid="expandable-text-button"]') ?
		button.querySelector('[style*="pointer-events: auto"]') :
		null;
	const target = pointerTarget instanceof HTMLElement ? pointerTarget : button;
	target.click();
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

function findTranslateButtons(root: ParentNode): HTMLElement[] {
	const buttons = [];
	const seen = new Set();

	for (const candidate of queryElements(root, 'button, [role="button"], a')) {
		if (seen.has(candidate) || !isTranslateButton(candidate)) continue;
		seen.add(candidate);
		buttons.push(candidate);
	}

	return buttons;
}

function isTranslateButton(button: HTMLElement): boolean {
	if (button.closest('[data-les-ignore="true"], nav, header, [role="menu"], [role="menubar"], .global-nav')) return false;
	if (button.hasAttribute('disabled') || button.getAttribute('aria-expanded') === 'true') return false;
	if (!button.closest('main, [role="main"], #workspace')) return false;

	const text = normalizeText([
		button.getAttribute('aria-label') || '',
		button.getAttribute('title') || '',
		button.textContent || '',
	].join(' '));

	return /^(?:(?:see|show)\s+)?translation\.?$/i.test(text) || /^translate\.?$/i.test(text);
}

function getReadMoreControl(candidate: HTMLElement): ?HTMLElement {
	const control = candidate.closest('button, [role="button"], a');
	if (control instanceof HTMLElement && isContentExpansionContext(control)) {
		if (
			control !== candidate &&
			(
				control.dataset.testid === 'expandable-text-button' ||
				control.getAttribute('aria-hidden') === 'true' ||
				control.style.pointerEvents === 'none'
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
		button.textContent || '',
	].join(' '));

	if (/\b(?:comments?|replies|reactions?|results|filters?)\b/i.test(text)) return false;
	if (/\b(?:options?|menu|account|profile|jobs?|messages?|notifications?)\b/i.test(text)) return false;
	if (button.closest('[data-testid="expandable-text-button"]')) return isReadMoreText(text);
	if (!isContentExpansionContext(button)) return false;

	return isReadMoreText(text);
}

function isReadMoreText(text: string): boolean {
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
		'[class*="comment" i]',
		'[data-testid*="comment" i]',
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

function readingDensityFromOption(value: mixed): 'compact' | 'reader' {
	if (value === 'reader') return value;
	return 'compact';
}

function feedLayoutFromOption(value: mixed): FeedLayout {
	if (value === 'native' || value === 'multi-column') return value;
	return 'native';
}

function readerColumnWidthsFromOption(value: mixed): [number, number, number] {
	const parsed = String(value).split(',').map(Number);
	if (parsed.length !== 3 || parsed.some(width => !Number.isFinite(width) || width < READER_COLUMN_MIN_WIDTH)) return [33, 34, 33];

	const total = parsed.reduce((sum, width) => sum + width, 0);
	if (!total) return [33, 34, 33];
	return [
		(parsed[0] / total) * 100,
		(parsed[1] / total) * 100,
		(parsed[2] / total) * 100,
	];
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
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
