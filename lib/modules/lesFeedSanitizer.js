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
type TvQueueMode = 'empty' | 'events' | 'surf' | 'tagged';
type TvItem = {|
	id: string,
	title: string,
	sourceURL: string,
	kind: 'live' | 'event' | 'video',
	video: ?HTMLVideoElement,
	registration: ?HTMLButtonElement,
|};
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
const CONTROL_TV_CLASS = 'les-feed-sanitizer-control-tv';
const CONTROL_VISIBLE_CLASS = 'les-feed-sanitizer-control-visible';
const PRIMARY_HEADER_CLASS = 'les-primary-header-anchor';
const NIGHT_MODE_CLASS = 'les-night-mode';
const WEEDS_MODE_CLASS = 'les-weeds-mode';
const WEEDS_MATCH_CLASS = 'les-weeds-match';
const WEEDS_HIDDEN_CLASS = 'les-weeds-hidden';
const READER_HIDDEN_POST_CLASS = 'les-reader-hidden-post';
const READER_LOAD_GATE_CLASS = 'les-reader-load-gate';
const READER_COLUMN_CANVAS_CLASS = 'les-reader-column-canvas';
const READER_COLUMN_RESIZER_CLASS = 'les-reader-column-resizer';
const COMPACT_MEDIA_COLLAPSED_CLASS = 'les-compact-media-collapsed';
const COMPACT_MEDIA_ITEM_CLASS = 'les-compact-media-item';
const READER_PRIMARY_CONTENT_CLASS = 'les-reader-primary-content';
const FEED_COMPOSER_CLASS = 'les-feed-composer';
const TV_VIEWER_CLASS = 'les-tv-viewer';
const TV_VIEWER_OPEN_CLASS = 'les-tv-open';
const READER_BATCH_SIZE = 10;
const READER_COLUMN_MIN_WIDTH = 18;
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
let tvQueue: TvItem[] = [];
let tvActiveIndex = 0;
let tvInvoker: ?HTMLElement;
let tvQueueMode: TvQueueMode = 'empty';
let tvQueueSignature = '';
let tvQueueRefreshTimer: ?TimeoutID;
let stickySurfaceObserver: ?ResizeObserver;
let stickyHeader: ?HTMLElement;
let stickyControl: ?HTMLElement;
let stickyOffsetFrame: ?number;
let readerLayoutFrame: ?number;
let scanFrame: ?number;
let fullScanPending = false;
let readerLayoutPending = false;
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
	weedsMode: {
		type: 'boolean',
		value: false,
		title: 'The Weeds',
		description: 'Show only content that the active feed rules would otherwise filter.',
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
	lesTVHashtag: {
		type: 'text',
		value: 'LinkedInLive',
		title: 'LES TV hashtag',
		description: 'Preferred hashtag channel for LES TV. When no matching media is available, LES TV surfs videos detected in the current feed.',
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

module.shouldRun = () => isLinkedInHost();
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
	if (changedSettings.lesTVHashtag) refreshTVQueue();
	if (changedSettings.nightMode) {
		applyNightModeClass();
		syncControlState();
	}
	if (changedSettings.weedsMode) {
		applyWeedsModeClass();
		syncControlState();
		updateReaderLoadGate();
	}
	applyPageContextClass();
};
module.contentStart = () => {
	applyReadingDensityClass();
	applyFeedLayoutClass();
	applyReaderColumnWidths();
	applyNightModeClass();
	applyWeedsModeClass();
	applyPageContextClass();
	mountControl();
	setupControlHotkeys();
	startExtensionScanReporting();
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
	document.documentElement.classList.toggle(NIGHT_MODE_CLASS, module.options.nightMode.value);
}

function applyWeedsModeClass() {
	document.documentElement.classList.toggle(WEEDS_MODE_CLASS, module.options.weedsMode.value);
}

function mountControl() {
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
			<button class="${CONTROL_TV_CLASS}" type="button" title="Open LES TV">TV 0</button>
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
	const tvButton = control.querySelector(`.${CONTROL_TV_CLASS}`);
	const expandToggle = control.querySelector('input[type="checkbox"]');
	const translateToggle = control.querySelector(`.${CONTROL_TRANSLATE_CLASS} input`);
	const nightModeToggle = control.querySelector(`.${CONTROL_NIGHT_MODE_CLASS} input`);
	if (!(densitySelect instanceof HTMLSelectElement) || !(settingsLink instanceof HTMLAnchorElement) || !(tvButton instanceof HTMLButtonElement) || !(expandToggle instanceof HTMLInputElement) || !(translateToggle instanceof HTMLInputElement) || !(nightModeToggle instanceof HTMLInputElement)) return;

	settingsLink.addEventListener('click', event => {
		event.preventDefault();
		openNewTab(settingsLink.href);
	});
	tvButton.addEventListener('click', () => openTVViewer(tvButton));

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
	syncTVControl(control);
	control.setAttribute('title', 'Ctrl+Shift+L: show LES controls. Ctrl+Shift+Left/Right: switch reading mode.');
}

function syncTVControl(existingControl?: Element) {
	const control = existingControl || document.querySelector(`.${CONTROL_CLASS}`);
	const button = control?.querySelector(`.${CONTROL_TV_CLASS}`);
	if (!(button instanceof HTMLButtonElement)) return;

	const text = `TV ${tvQueue.length}`;
	const tag = normalizedTVHashtag(module.options.lesTVHashtag.value);
	let title = 'Open LES TV. It fills from visible Live, event, and video content.';
	if (tvQueue.length && tvQueueMode === 'tagged') {
		title = `Open LES TV's #${tag} channel with ${tvQueue.length} available item${tvQueue.length === 1 ? '' : 's'}`;
	} else if (tvQueue.length && tvQueueMode === 'surf') {
		title = `Open LES TV in Surf mode with ${tvQueue.length} detected video${tvQueue.length === 1 ? '' : 's'}; no #${tag} media is currently available`;
	} else if (tvQueue.length) {
		title = `Open LES TV with ${tvQueue.length} upcoming event${tvQueue.length === 1 ? '' : 's'}`;
	}
	if (button.textContent !== text) button.textContent = text;
	if (button.title !== title) button.title = title;
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

function scan(root?: ParentNode, updateReaderLayout: boolean = true) {
	if (root instanceof HTMLElement && root.closest('[data-les-ignore="true"]')) return;

	if (!root || updateReaderLayout) {
		applyPageContextClass();
		mountControl();
		applyReaderPrimaryContentClass();
		positionFeedComposer();
		mountReaderColumnResizers();
	}
	applyCompactMediaCollapse(root || document);
	expandReadableContent(root || document);
	scheduleTVQueueRefresh(root);

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

	const feedPosts = findFeedPosts(root || document);
	for (const post of feedPosts) {
		processPost(post);
	}

	if (updateReaderLayout) {
		const readerPosts = findReaderPosts(feedPosts);
		updateWeedsFeed(readerPosts);
		updateReaderLoadGate(readerPosts);
	}
}

function scheduleTVQueueRefresh(root?: ParentNode) {
	if (!shouldRefreshTVQueue(root)) return;
	if (tvQueueRefreshTimer) return;
	tvQueueRefreshTimer = setTimeout(() => {
		tvQueueRefreshTimer = undefined;
		refreshTVQueue();
	}, 500);
}

function shouldRefreshTVQueue(root?: ParentNode): boolean {
	if (!root || root === document) return true;
	if (!(root instanceof HTMLElement)) return false;
	if (root.matches('video, [role="listitem"], article, li') || root.querySelector('video')) return true;
	return /^\/mynetwork\/network-manager\/events(?:\/|$)/i.test(location.pathname) && !!root.closest('[role="listitem"], article, li');
}

function refreshTVQueue() {
	const active = tvQueue[tvActiveIndex];
	const detectedVideos = [];
	const taggedVideos = [];
	const events = [];
	const seen = new Set();
	const tag = normalizedTVHashtag(module.options.lesTVHashtag.value);

	for (const post of findFeedPosts(document)) {
		const video = post.querySelector('video');
		if (!(video instanceof HTMLVideoElement)) continue;
		const text = normalizeText(post.textContent || '');
		const kind = /\b(live now|happening now|streaming now|linkedin live)\b/i.test(text) ? 'live' : 'video';
		const item = createTVItem(post, kind, video);
		if (!item || seen.has(item.id)) continue;
		seen.add(item.id);
		detectedVideos.push(item);
		if (matchesTVHashtag(post, tag)) taggedVideos.push(item);
	}

	if (/^\/mynetwork\/network-manager\/events(?:\/|$)/i.test(location.pathname)) {
		for (const event of queryElements(document, 'li, article, [role="listitem"]')) {
			const text = normalizeText(event.textContent || '');
			if (!/\b(live now|happening now|streaming now|today|tomorrow|starting soon|starts in\s+\d+)\b/i.test(text)) continue;
			const item = createTVItem(event, 'event', null);
			if (!item || seen.has(item.id)) continue;
			seen.add(item.id);
			events.push(item);
		}
	}

	const selectedVideos = taggedVideos.length ? taggedVideos : detectedVideos;
	const items = [...events, ...selectedVideos];
	tvQueueMode = taggedVideos.length ? 'tagged' :
		detectedVideos.length ? 'surf' :
		events.length ? 'events' :
		'empty';
	const priority = { live: 0, event: 1, video: 2 };
	items.sort((first, second) => priority[first.kind] - priority[second.kind]);
	const nextSignature = `${tvQueueMode}:${items.map(item => item.id).join('|')}`;
	const queueChanged = nextSignature !== tvQueueSignature;
	tvQueueSignature = nextSignature;
	tvQueue = items;
	if (active) {
		const activeIndex = tvQueue.findIndex(item => item.id === active.id);
		tvActiveIndex = activeIndex === -1 ? 0 : activeIndex;
	} else {
		tvActiveIndex = 0;
	}
	syncTVControl();
	if (queueChanged && document.documentElement.classList.contains(TV_VIEWER_OPEN_CLASS)) renderTVViewer();
}

function createTVItem(container: HTMLElement, kind: 'live' | 'event' | 'video', video: ?HTMLVideoElement): ?TvItem {
	const source = container.querySelector('a[href*="/feed/update/"], a[href*="/posts/"], a[href*="/events/"], a[href*="/video/"]');
	const sourceURL = source instanceof HTMLAnchorElement ? source.href : '';
	const title = normalizeText(container.textContent || '').slice(0, 180);
	if (!title || !sourceURL) return null;

	return {
		id: `${kind}:${sourceURL}`,
		title,
		sourceURL,
		kind,
		video,
		registration: kind === 'event' ? findEventRegistrationButton(container) : null,
	};
}

function findEventRegistrationButton(container: HTMLElement): ?HTMLButtonElement {
	for (const button of queryElements(container, 'button')) {
		const text = normalizeText([button.getAttribute('aria-label') || '', button.textContent || ''].join(' '));
		if (/\bregister\b/i.test(text) && !button.disabled) return button;
	}
}

function normalizedTVHashtag(value: mixed): string {
	const tag = String(value || '').replace(/^\s*#?\s*/, '').replace(/\s+/g, '');
	return tag || 'LinkedInLive';
}

function matchesTVHashtag(container: HTMLElement, tag: string): boolean {
	const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const text = normalizeText(container.textContent || '');
	if (new RegExp(`(?:^|\\s)#${escapedTag}(?![a-z\\d_])`, 'i').test(text)) return true;

	for (const anchor of queryElements(container, 'a[href*="/hashtag/"], a[href*="keywords="]')) {
		if (!(anchor instanceof HTMLAnchorElement)) continue;
		const anchorTag = normalizeText(anchor.textContent || '').replace(/^#/, '');
		if (anchorTag.toLowerCase() === tag.toLowerCase()) return true;
		try {
			const keyword = new URL(anchor.href).searchParams.get('keywords') || '';
			if (decodeURIComponent(keyword).replace(/^#/, '').toLowerCase() === tag.toLowerCase()) return true;
		} catch (error) {
			// Ignore malformed LinkedIn links and continue matching visible hashtag text.
		}
	}
	return false;
}

function openTVViewer(invoker: HTMLElement) {
	tvInvoker = invoker;
	document.documentElement.classList.add(TV_VIEWER_OPEN_CLASS);
	mountTVViewer();
	renderTVViewer();
	document.querySelector(`.${TV_VIEWER_CLASS} .les-tv-close`)?.focus();
}

function closeTVViewer() {
	const viewer = document.querySelector(`.${TV_VIEWER_CLASS}`);
	viewer?.querySelector('video')?.pause();
	document.documentElement.classList.remove(TV_VIEWER_OPEN_CLASS);
	viewer?.remove();
	tvInvoker?.focus();
}

function mountTVViewer() {
	if (document.querySelector(`.${TV_VIEWER_CLASS}`)) return;
	const viewer = string.html`
		<section class="${TV_VIEWER_CLASS}" data-les-ignore="true" role="dialog" aria-modal="true" aria-label="LES TV">
			<header>
				<strong>LES TV</strong>
				<span class="les-tv-position" aria-live="polite"></span>
				<button class="les-tv-close" type="button" aria-label="Close LES TV">Close</button>
			</header>
			<div class="les-tv-stage"></div>
			<footer>
				<button class="les-tv-previous" type="button" aria-label="Previous item">Previous</button>
				<a class="les-tv-events" href="https://www.linkedin.com/mynetwork/network-manager/events/" target="_blank" rel="noopener">Events</a>
				<a class="les-tv-hashtag" target="_blank" rel="noopener">Hashtag</a>
				<button class="les-tv-register" type="button">Register</button>
				<a class="les-tv-source" target="_blank" rel="noopener">Open on LinkedIn</a>
				<button class="les-tv-next" type="button" aria-label="Next item">Next</button>
			</footer>
		</section>
	`;
	viewer.querySelector('.les-tv-close')?.addEventListener('click', closeTVViewer);
	viewer.querySelector('.les-tv-previous')?.addEventListener('click', () => moveTVItem(-1));
	viewer.querySelector('.les-tv-next')?.addEventListener('click', () => moveTVItem(1));
	viewer.querySelector('.les-tv-register')?.addEventListener('click', registerForActiveTVEvent);
	viewer.addEventListener('keydown', event => {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeTVViewer();
		}
	});
	document.body.append(viewer);
}

function moveTVItem(direction: number) {
	if (!tvQueue.length) return;
	tvActiveIndex = (tvActiveIndex + direction + tvQueue.length) % tvQueue.length;
	renderTVViewer();
}

function renderTVViewer() {
	const viewer = document.querySelector(`.${TV_VIEWER_CLASS}`);
	if (!(viewer instanceof HTMLElement)) return;
	const stage = viewer.querySelector('.les-tv-stage');
	const position = viewer.querySelector('.les-tv-position');
	const source = viewer.querySelector('.les-tv-source');
	const hashtag = viewer.querySelector('.les-tv-hashtag');
	const register = viewer.querySelector('.les-tv-register');
	if (!(stage instanceof HTMLElement) || !(position instanceof HTMLElement) || !(source instanceof HTMLAnchorElement) || !(hashtag instanceof HTMLAnchorElement) || !(register instanceof HTMLButtonElement)) return;

	stage.querySelector('video')?.pause();
	stage.textContent = '';
	const tag = normalizedTVHashtag(module.options.lesTVHashtag.value);
	hashtag.href = `https://www.linkedin.com/feed/hashtag/?keywords=${encodeURIComponent(`#${tag}`)}`;
	hashtag.textContent = `#${tag}`;
	const item = tvQueue[tvActiveIndex];
	if (!item) {
		position.textContent = 'No items queued';
		stage.append(string.html`<p>Browse LinkedIn Live, native feed videos, or Network Events to add items to this tab's LES TV queue.</p>`);
		source.hidden = true;
		register.hidden = true;
		return;
	}

	const modeLabel = tvQueueMode === 'tagged' ? `#${tag}` :
		tvQueueMode === 'surf' ? 'Surf' :
		'Events';
	position.textContent = `${modeLabel} - ${tvActiveIndex + 1} of ${tvQueue.length}`;
	source.href = item.sourceURL;
	source.hidden = false;
	register.hidden = !item.registration;
	stage.append(string.html`<p class="les-tv-kind">${item.kind === 'live' ? 'LIVE' : item.kind === 'event' ? 'EVENT' : 'VIDEO'}</p>`);
	stage.append(string.html`<h2>${item.title}</h2>`);
	const playable = createTVPlayer(item.video);
	if (playable) stage.append(playable);
	else stage.append(string.html`<p class="les-tv-unavailable">This item is available on LinkedIn. Open the original item to watch or join.</p>`);
}

function registerForActiveTVEvent() {
	const item = tvQueue[tvActiveIndex];
	if (!item || !(item.registration instanceof HTMLButtonElement)) return;
	if (!window.confirm(`Register for this LinkedIn event?\n\n${item.title}`)) return;
	item.registration.click();
	scheduleTVQueueRefresh();
}

function createTVPlayer(source: ?HTMLVideoElement): ?HTMLVideoElement {
	if (!(source instanceof HTMLVideoElement)) return null;
	const src = source.currentSrc || source.src;
	if (!src) return null;
	const player = document.createElement('video');
	player.controls = true;
	player.playsInline = true;
	player.preload = 'metadata';
	player.src = src;
	player.setAttribute('aria-label', 'LES TV player');
	return player;
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

function updateWeedsFeed(readerPosts?: HTMLElement[]) {
	const posts = readerPosts || findReaderPosts();
	if (!module.options.weedsMode.value) {
		for (const post of posts) {
			post.classList.remove(WEEDS_MATCH_CLASS, WEEDS_HIDDEN_CLASS);
		}
		return;
	}

	for (const post of posts) {
		const matches = !!classifyPost(post) || !!post.querySelector([
			`[data-${GAME_PROCESSED.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}]`,
			`[data-${NEWS_PROCESSED.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}]`,
		].join(', '));
		post.classList.toggle(WEEDS_MATCH_CLASS, matches);
		post.classList.toggle(WEEDS_HIDDEN_CLASS, !matches);
	}
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
	return readingDensityFromOption(module.options.readingDensity.value) === 'reader' && !module.options.weedsMode.value && /^\/feed(?:\/|$)/i.test(location.pathname);
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
			updateWeedsFeed(readerPosts);
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
	if (module.options.autoExpand.value) {
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
