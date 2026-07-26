/* @flow */

import DOMPurify from 'dompurify';
import { markdown } from 'snudown-js';

import { Module } from '../core/module';
import { Storage } from '../environment';
import { string } from '../utils';
import { isLinkedInHost } from '../utils/linkedin';

export const module: Module<*> = new Module('postDrafts');

type Draft = {|
	id: string,
	title: string,
	body: string,
	format: 'markdown',
	images: DraftImage[],
	createdAt: number,
	updatedAt: number,
|};
type DraftImage = {|
	id: string,
	name: string,
	type: string,
	dataURL: string,
|};
type ComposerContent = {|
	html: string,
	text: string,
	matchText: string,
|};

const STORAGE_KEY = 'LES.postDrafts';
const MAX_DRAFTS = 50;
const MAX_DRAFT_IMAGES = 9;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LINKEDIN_POST_CHARACTER_LIMIT = 3000;
const TOOLBAR_CLASS = 'les-post-drafts-toolbar';
const TOOLBAR_PORTAL_CLASS = 'les-post-drafts-toolbar-portal';
const PICKER_CLASS = 'les-post-drafts-picker';
const MANAGER_CLASS = 'les-post-drafts-manager';
const COMPOSER_ACTION_PATTERN = /\b(?:emoji|enhance post|add media|more|celebrat|expert)\b/i;
const EDITOR_SELECTOR = [
	'.ql-editor[data-test-ql-editor-contenteditable="true"]',
	'[contenteditable="true"][aria-label="Text editor for creating content"]',
	'[contenteditable]:not([contenteditable="false"])',
	'textarea[aria-label*="post" i]',
	'textarea[placeholder*="post" i]',
].join(', ');
const COMPOSER_ROOT_SELECTOR = '.share-box, .share-creation-state, [role="dialog"], .artdeco-modal';

const storage = Storage.wrap(STORAGE_KEY, ([]: Draft[]));
const editorSaveTimers: WeakMap<HTMLElement, TimeoutID> = new WeakMap();
const programmaticEditorUpdates: WeakSet<HTMLElement> = new WeakSet();
let drafts: Draft[] = [];
let manager: ?HTMLElement;
let activeDraftId: ?string;
let activeEditor: ?HTMLElement;
let managerSaveTimer: ?TimeoutID;
let started = false;
let startupScheduled = false;
let portalToolbar: ?HTMLElement;
let portalActionRow: ?HTMLElement;

module.moduleName = 'Post Drafts';
module.category = 'LinkedIn';
module.description = 'Create, preview, and restore local Markdown drafts with images from the LinkedIn post composer.';
module.options = {
	autosave: {
		type: 'boolean',
		value: true,
		title: 'Autosave loaded drafts',
		description: 'Save changes automatically after an LES draft is loaded into the LinkedIn post composer.',
	},
};
module.alwaysEnabled = true;
module.shouldRun = () => isLinkedInHost();
module.onInit = () => startPostDrafts();
module.contentStart = () => startPostDrafts();

export function startPostDrafts() {
	if (started || !isLinkedInHost()) return;
	if (!document.body) {
		if (!startupScheduled) {
			startupScheduled = true;
			document.addEventListener('DOMContentLoaded', () => {
				startupScheduled = false;
				startPostDrafts();
			}, { once: true });
		}
		return;
	}
	started = true;
	document.documentElement.dataset.lesPostDrafts = 'ready';
	startObserver();
	startInteractionDiscovery();
	scanEditors(document);
	mountManager();
	window.addEventListener('resize', positionPortalToolbar);
	window.addEventListener('scroll', positionPortalToolbar, true);
	pollNativeToolbar();

	for (const delay of [250, 1000, 3000]) {
		setTimeout(() => {
			scanEditors(document);
			pollNativeToolbar();
		}, delay);
	}
	storage.get()
		.then(value => {
			drafts = normalizeDrafts(value);
			refreshToolbars();
			renderManager();
		})
		.catch(error => {
			console.error('Unable to load LES post drafts:', error);
		});
}

function pollNativeToolbar() {
	try {
		const toolbar = document.querySelector('.share-creation-state__additional-toolbar');
		document.documentElement.dataset.lesPostDraftsToolbarMatches = toolbar ? '1' : '0';
		if (toolbar instanceof HTMLElement) {
			mountToolbarAt(toolbar, findEditorNearSurface(toolbar));
		} else {
			positionPortalToolbar();
		}
	} catch (error) {
		document.documentElement.dataset.lesPostDraftsError = String(error);
		console.error('Unable to mount LES post drafts toolbar:', error);
	}
}

function normalizeDrafts(value: mixed): Draft[] {
	if (!Array.isArray(value)) return [];
	const normalized = [];
	for (const candidate of value) {
		const draft: any = candidate;
		if (draft &&
		typeof draft.id === 'string' &&
		typeof draft.title === 'string' &&
		typeof draft.body === 'string' &&
		typeof draft.createdAt === 'number' &&
		typeof draft.updatedAt === 'number') {
			normalized.push({
				id: draft.id,
				title: draft.title,
				body: draft.body,
				format: 'markdown',
				images: normalizeDraftImages(draft.images),
				createdAt: draft.createdAt,
				updatedAt: draft.updatedAt,
			});
		}
	}
	return normalized.slice(0, MAX_DRAFTS);
}

function normalizeDraftImages(value: mixed): DraftImage[] {
	if (!Array.isArray(value)) return [];
	return value.filter(image => (
		image &&
		typeof image.id === 'string' &&
		typeof image.name === 'string' &&
		typeof image.type === 'string' &&
		typeof image.dataURL === 'string' &&
		image.dataURL.startsWith('data:image/')
	)).slice(0, MAX_DRAFT_IMAGES);
}

function createDraft(body: string = ''): Draft {
	const now = Date.now();
	return {
		id: createDraftId(now),
		title: titleFromBody(body),
		body,
		format: 'markdown',
		images: [],
		createdAt: now,
		updatedAt: now,
	};
}

function createDraftId(now: number): string {
	const randomUUID = window.crypto && (window.crypto: any).randomUUID;
	return typeof randomUUID === 'function' ?
		Reflect.apply(randomUUID, window.crypto, []) :
		`${now}-${Math.random().toString(36).slice(2)}`;
}

function titleFromBody(body: string): string {
	const firstLine = body.split(/\r?\n/).map(line => line.trim()).find(Boolean) || 'Untitled draft';
	return firstLine.length > 64 ? `${firstLine.slice(0, 61)}...` : firstLine;
}

async function persistDrafts() {
	drafts = drafts
		.slice()
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, MAX_DRAFTS);
	await storage.set(drafts);
	renderManager();
	refreshToolbars();
}

function scanEditors(root: Document | HTMLElement) {
	scanNativeToolbars(root);
	const editors = new Set();
	if (root instanceof HTMLElement && root.matches(EDITOR_SELECTOR)) editors.add(root);
	for (const editor of root.querySelectorAll(EDITOR_SELECTOR)) editors.add(editor);
	const composerBottoms = [];
	if (root instanceof HTMLElement && root.matches('.share-creation-state__bottom')) composerBottoms.push(root);
	for (const bottom of root.querySelectorAll('.share-creation-state__bottom')) composerBottoms.push(bottom);
	for (const bottom of composerBottoms) {
		if (!(bottom instanceof HTMLElement)) continue;
		const editor = findEditorNearSurface(bottom);
		if (editor) editors.add(editor);
	}
	for (const control of root.querySelectorAll('button, [role="button"]')) {
		if (!/^post$/i.test(controlText(control))) continue;
		const surface = findComposerSurfaceFromControl(control);
		if (!surface) continue;
		for (const editor of surface.querySelectorAll(EDITOR_SELECTOR)) editors.add(editor);
	}

	for (const editor of editors) {
		if (!(editor instanceof HTMLElement) || editor.closest('[data-les-ignore="true"]')) continue;
		if (!findComposerContainer(editor)) continue;
		mountToolbar(editor);
	}
}

function scanNativeToolbars(root: Document | HTMLElement) {
	const toolbars = [];
	if (root instanceof HTMLElement && root.matches('.share-creation-state__additional-toolbar')) toolbars.push(root);
	for (const toolbar of root.querySelectorAll('.share-creation-state__additional-toolbar')) toolbars.push(toolbar);
	for (const toolbar of toolbars) {
		if (toolbar instanceof HTMLElement) mountToolbarAt(toolbar, findEditorNearSurface(toolbar));
	}
}

function mountToolbar(editor: HTMLElement) {
	if (editor.dataset.lesPostDraftsMounted === 'true') return;
	const actionRow = findComposerActionRow(editor);
	if (!actionRow) return;
	mountToolbarAt(actionRow, editor);
}

function mountToolbarAt(actionRow: HTMLElement, editor: ?HTMLElement) {
	if (portalToolbar && portalActionRow === actionRow && document.body.contains(portalToolbar)) {
		if (editor) bindEditorAutosave(editor, portalToolbar);
		positionPortalToolbar();
		return;
	}
	removePortalToolbar();

	const toolbar = string.html`
		<div class="${TOOLBAR_CLASS} ${TOOLBAR_PORTAL_CLASS}" data-les-ignore="true">
			<button type="button" data-action="toggle" aria-haspopup="menu" aria-expanded="false">Drafts (${drafts.length})</button>
			<div class="${PICKER_CLASS}" role="menu" hidden>
				<strong>LES post drafts</strong>
				<button type="button" data-action="capture" role="menuitem">Save current as draft</button>
				<div class="les-post-drafts-picker-list"></div>
				<button type="button" data-action="manage" role="menuitem">Manage drafts...</button>
			</div>
			<span role="status" aria-live="polite"></span>
			</div>
		`;
	document.body.append(toolbar);
	portalToolbar = toolbar;
	portalActionRow = actionRow;
	positionPortalToolbar();
	renderPicker(toolbar);

	toolbar.addEventListener('click', (event: MouseEvent) => {
		const button = event.target instanceof Element && event.target.closest('button');
		if (!(button instanceof HTMLButtonElement)) return;
		const currentEditor = resolveToolbarEditor(toolbar, editor);
		if (currentEditor) activeEditor = currentEditor;

		if (button.dataset.action === 'toggle') {
			togglePicker(toolbar);
		} else if (button.dataset.action === 'capture') {
			if (currentEditor) captureEditor(currentEditor, toolbar);
			else setToolbarStatus(toolbar, 'Composer editor not found');
		} else if (button.dataset.action === 'manage') {
			closePickers();
			openManager(currentEditor);
		} else if (button.dataset.draftId) {
			loadDraftIntoEditor(button.dataset.draftId, currentEditor, toolbar);
		}
	});

	if (editor) bindEditorAutosave(editor, toolbar);
}

function positionPortalToolbar() {
	if (!portalToolbar || !portalActionRow) return;
	if (!portalToolbar.isConnected || !portalActionRow.isConnected) {
		removePortalToolbar();
		return;
	}
	const anchor = portalActionRow.querySelector(
		'button[aria-label="Open Emoji Keyboard"], button[title="Open Emoji Keyboard"], button',
	);
	if (!(anchor instanceof HTMLElement)) return;
	const rect = anchor.getBoundingClientRect();
	portalToolbar.style.left = `${Math.round(rect.right + 6)}px`;
	portalToolbar.style.top = `${Math.round(rect.top + (rect.height - portalToolbar.offsetHeight) / 2)}px`;
}

function removePortalToolbar() {
	if (portalToolbar) portalToolbar.remove();
	portalToolbar = null;
	portalActionRow = null;
}

function resolveToolbarEditor(toolbar: HTMLElement, fallback: ?HTMLElement): ?HTMLElement {
	const portalEditor = portalActionRow && portalActionRow.isConnected ?
		findEditorNearSurface(portalActionRow) :
		null;
	const visibleFallback = fallback &&
		fallback.isConnected &&
		(fallback.offsetParent || fallback.getClientRects().length) ?
		fallback :
		null;
	const editor = portalEditor || findEditorNearSurface(toolbar) || visibleFallback || findActiveComposerEditor();
	if (editor) bindEditorAutosave(editor, toolbar);
	return editor;
}

function findActiveComposerEditor(): ?HTMLElement {
	if (activeEditor && isVisibleComposerEditor(activeEditor)) return activeEditor;
	for (const candidate of document.querySelectorAll(EDITOR_SELECTOR)) {
		if (candidate instanceof HTMLElement && isVisibleComposerEditor(candidate)) return candidate;
	}
	return null;
}

function isVisibleComposerEditor(editor: HTMLElement): boolean {
	return (
		editor.isConnected &&
		!editor.closest(`.${MANAGER_CLASS}`) &&
		!!editor.closest(COMPOSER_ROOT_SELECTOR) &&
		!!(editor.offsetParent || editor.getClientRects().length)
	);
}

function bindEditorAutosave(editor: HTMLElement, toolbar: HTMLElement) {
	editor.dataset.lesPostDraftsMounted = 'true';
	if (editor.dataset.lesPostDraftsAutosaveBound === 'true') return;
	editor.dataset.lesPostDraftsAutosaveBound = 'true';
	editor.addEventListener('input', () => {
		if (programmaticEditorUpdates.has(editor)) return;
		if (module.options.autosave.value) scheduleEditorSave(editor, toolbar);
	});
}

function startInteractionDiscovery() {
	const discover = (event: Event) => {
		const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
		let editor = null;
		let toolbar = null;

		for (const target of path) {
			if (!(target instanceof HTMLElement)) continue;
			if (!toolbar) {
				if (target.matches('.share-creation-state__additional-toolbar')) {
					toolbar = target;
				} else {
					const closestToolbar = target.closest('.share-creation-state__additional-toolbar');
					if (closestToolbar instanceof HTMLElement) toolbar = closestToolbar;
				}
			}
			if (!editor && target.matches(EDITOR_SELECTOR)) editor = target;
		}

		const rootTarget = editor || toolbar || path.find(target => target instanceof HTMLElement);
		const root = rootTarget instanceof HTMLElement && rootTarget.getRootNode();
		if (!toolbar && root && typeof (root: any).querySelector === 'function') {
			const rootToolbar = (root: any).querySelector('.share-creation-state__additional-toolbar');
			if (rootToolbar instanceof HTMLElement) toolbar = rootToolbar;
		}
		if (!editor && root && typeof (root: any).querySelector === 'function') {
			const rootEditor = (root: any).querySelector(EDITOR_SELECTOR);
			if (rootEditor instanceof HTMLElement) editor = rootEditor;
		}

		if (toolbar) {
			document.documentElement.dataset.lesPostDraftsToolbarMatches = 'event';
			mountToolbarAt(toolbar, editor || findEditorNearSurface(toolbar));
		} else if (editor) {
			mountToolbar(editor);
		}
	};

	for (const eventName of ['click', 'focusin', 'input']) {
		document.addEventListener(eventName, discover, true);
	}
}

function findComposerActionRow(editor: HTMLElement): ?HTMLElement {
	const container = findComposerContainer(editor);
	if (!container) return null;
	const nativeToolbar = container.querySelector('.share-creation-state__additional-toolbar');
	if (nativeToolbar instanceof HTMLElement) return nativeToolbar;
	const controls = Array.from(container.querySelectorAll('button, [role="button"]'))
		.filter(control => control instanceof HTMLElement && COMPOSER_ACTION_PATTERN.test(controlText(control)));
	const preferred = controls.find(control => /emoji|enhance post|add media/i.test(controlText(control))) || controls[0];
	if (!(preferred instanceof HTMLElement)) return null;

	let candidate = preferred.parentElement;
	while (candidate && candidate !== container) {
		const matchingControls = controls.filter(control => candidate && candidate.contains(control));
		if (matchingControls.length >= 2 && candidate instanceof HTMLElement) return candidate;
		candidate = candidate.parentElement;
	}
	const parent = preferred.parentElement;
	return parent instanceof HTMLElement ? parent : null;
}

function findComposerContainer(editor: HTMLElement): ?HTMLElement {
	const explicitRoot = editor.closest('.share-creation-state, .share-box');
	if (explicitRoot instanceof HTMLElement) return explicitRoot;
	let candidate = editor.parentElement;
	while (candidate && candidate !== document.body) {
		if (candidate instanceof HTMLElement && hasComposerControls(candidate)) return candidate;
		candidate = candidate.parentElement;
	}
	return null;
}

function hasComposerControls(container: HTMLElement): boolean {
	const controls = Array.from(container.querySelectorAll('button, [role="button"]'));
	const hasActionControl = controls.some(control => COMPOSER_ACTION_PATTERN.test(controlText(control)));
	if (!hasActionControl) return false;
	const hasPostButton = controls.some(control => /^post$/i.test(controlText(control)));
	const accessibleName = [
		container.getAttribute('aria-label') || '',
		container.getAttribute('data-testid') || '',
		container.textContent || '',
	].join(' ');
	return hasPostButton || /\b(?:create|share|write).{0,20}post\b/i.test(accessibleName);
}

function findComposerSurfaceFromControl(control: Element): ?HTMLElement {
	let candidate = control.parentElement;
	while (candidate && candidate !== document.body) {
		if (candidate instanceof HTMLElement &&
		candidate.querySelector(EDITOR_SELECTOR) &&
		hasComposerControls(candidate)) return candidate;
		candidate = candidate.parentElement;
	}
	return null;
}

function findEditorNearSurface(surface: HTMLElement): ?HTMLElement {
	const explicitRoot = surface.closest(COMPOSER_ROOT_SELECTOR);
	if (explicitRoot instanceof HTMLElement) {
		const explicitEditor = explicitRoot.querySelector(EDITOR_SELECTOR);
		if (explicitEditor instanceof HTMLElement && !explicitEditor.closest(`.${MANAGER_CLASS}`)) {
			return explicitEditor;
		}
	}
	let candidate = surface.parentElement;
	while (candidate && candidate !== document.body) {
		if (candidate instanceof HTMLElement && hasComposerControls(candidate)) {
			const editor = candidate.querySelector(EDITOR_SELECTOR);
			if (editor instanceof HTMLElement) return editor;
		}
		candidate = candidate.parentElement;
	}
	return null;
}

function controlText(control: Element): string {
	return [
		control.getAttribute('aria-label') || '',
		control.getAttribute('title') || '',
		control.textContent || '',
	].join(' ').replace(/\s+/g, ' ').trim();
}

function togglePicker(toolbar: HTMLElement) {
	const picker = toolbar.querySelector(`.${PICKER_CLASS}`);
	const trigger = toolbar.querySelector('[data-action="toggle"]');
	if (!(picker instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement)) return;
	const opening = picker.hidden;
	closePickers();
	picker.hidden = !opening;
	trigger.setAttribute('aria-expanded', String(opening));
	if (opening) {
		const first = picker.querySelector('button');
		if (first instanceof HTMLButtonElement) first.focus();
	}
}

function closePickers() {
	for (const picker of document.querySelectorAll(`.${PICKER_CLASS}`)) {
		if (picker instanceof HTMLElement) picker.hidden = true;
		const toolbar = picker.closest(`.${TOOLBAR_CLASS}`);
		const trigger = toolbar && toolbar.querySelector('[data-action="toggle"]');
		if (trigger) trigger.setAttribute('aria-expanded', 'false');
	}
}

function renderPicker(toolbar: HTMLElement) {
	const list = toolbar.querySelector('.les-post-drafts-picker-list');
	if (!(list instanceof HTMLElement)) return;
	list.textContent = '';
	if (!drafts.length) {
		list.append(string.html`<span class="les-post-drafts-picker-empty">No LES drafts yet</span>`);
		return;
	}

	for (const draft of drafts) {
		list.append(string.html`
			<button type="button" data-draft-id="${draft.id}" role="menuitem" title="Load ${draft.title}">
				<strong>${draft.title}</strong><span>${new Date(draft.updatedAt).toLocaleDateString()}</span>
			</button>
		`);
	}
}

async function loadDraftIntoEditor(draftId: string, editor: ?HTMLElement, toolbar: HTMLElement) {
	const draft = drafts.find(item => item.id === draftId);
	if (!draft) return;
	const content = markdownToComposerContent(draft.body);
	const copied = await copyDraftContent(content);
	const currentEditor = editor && isVisibleComposerEditor(editor) ? editor : findActiveComposerEditor();
	let loaded = false;
	if (currentEditor) {
		loaded = replaceEditorContent(currentEditor, content);
		if (loaded) {
			currentEditor.dataset.lesPostDraftId = draft.id;
			activeEditor = currentEditor;
			attachDraftImagesToComposer(currentEditor, draft);
		}
	}
	activeDraftId = draft.id;
	closePickers();
	if (copied && loaded) setToolbarStatus(toolbar, `Copied and loaded ${draft.title}`);
	else if (copied) setToolbarStatus(toolbar, `Copied ${draft.title}; paste into LinkedIn`);
	else if (loaded) setToolbarStatus(toolbar, `Loaded ${draft.title}`);
	else setToolbarStatus(toolbar, 'Unable to copy or load this draft');
}

async function copyDraftContent(content: ComposerContent): Promise<boolean> {
	try {
		const clipboard = (navigator: any).clipboard;
		const ClipboardItemConstructor = (window: any).ClipboardItem;
		if (clipboard && typeof clipboard.write === 'function' && typeof ClipboardItemConstructor === 'function') {
			await clipboard.write([new ClipboardItemConstructor({
				'text/html': new Blob([content.html], { type: 'text/html' }),
				'text/plain': new Blob([content.text], { type: 'text/plain' }),
			})]);
			return true;
		}
	} catch (error) {
		// The selection fallback below works when Clipboard API access is denied.
	}

	const clipboardSurface = document.createElement('div');
	clipboardSurface.contentEditable = 'true';
	clipboardSurface.innerHTML = content.html;
	clipboardSurface.dataset.lesIgnore = 'true';
	clipboardSurface.style.position = 'fixed';
	clipboardSurface.style.left = '-10000px';
	clipboardSurface.style.top = '0';
	document.body.append(clipboardSurface);
	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(clipboardSurface);
	selection?.removeAllRanges();
	selection?.addRange(range);
	const copied = document.execCommand('copy');
	selection?.removeAllRanges();
	clipboardSurface.remove();
	return copied;
}

async function captureEditor(editor: HTMLElement, toolbar: HTMLElement) {
	const body = readEditorText(editor);
	if (!body.trim()) {
		setToolbarStatus(toolbar, 'Nothing to save');
		return;
	}

	const draft = createDraft(body);
	drafts.unshift(draft);
	activeDraftId = draft.id;
	editor.dataset.lesPostDraftId = draft.id;
	await persistDrafts();
	setToolbarStatus(toolbar, 'Saved as a new draft');
}

function scheduleEditorSave(editor: HTMLElement, toolbar: HTMLElement) {
	const draftId = editor.dataset.lesPostDraftId;
	if (!draftId) return;

	const existing = editorSaveTimers.get(editor);
	if (existing) clearTimeout(existing);
	editorSaveTimers.set(editor, setTimeout(async () => {
		const draft = drafts.find(item => item.id === draftId);
		if (!draft) {
			delete editor.dataset.lesPostDraftId;
			return;
		}

		draft.body = readEditorText(editor);
		draft.updatedAt = Date.now();
		await persistDrafts();
		setToolbarStatus(toolbar, 'Autosaved');
	}, 600));
}

function readEditorText(editor: HTMLElement): string {
	if (editor instanceof HTMLTextAreaElement) return editor.value.trim();
	return (editor.innerText || editor.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function replaceEditorContent(editor: HTMLElement, content: ComposerContent): boolean {
	editor.focus();
	if (editor instanceof HTMLTextAreaElement) {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
		if (valueSetter) Reflect.apply(valueSetter, editor, [content.text]);
		else editor.value = content.text;
		dispatchEditorInput(editor, content.text);
		editor.dispatchEvent(new Event('change', { bubbles: true }));
		return editor.value === content.text;
	}

	const selection = window.getSelection();
	if (selection) {
		const range = document.createRange();
		range.selectNodeContents(editor);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	const inserted = document.execCommand('insertHTML', false, content.html);
	if (!inserted || !composerContentMatches(editor, content)) {
		replaceContentEditableChildren(editor, content.html);
	}
	editor.classList.toggle('ql-blank', !content.text);
	dispatchEditorInput(editor, content.text);
	editor.dispatchEvent(new Event('change', { bubbles: true }));
	editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
	const accepted = composerContentMatches(editor, content);
	if (accepted) stabilizeEditorContent(editor, content);
	return accepted;
}

function replaceContentEditableChildren(editor: HTMLElement, html: string) {
	const template = document.createElement('template');
	template.innerHTML = html;
	editor.replaceChildren(template.content.cloneNode(true));
}

function dispatchEditorInput(editor: HTMLElement, body: string) {
	programmaticEditorUpdates.add(editor);
	try {
		try {
			editor.dispatchEvent(new InputEvent('input', {
				bubbles: true,
				composed: true,
				data: body,
				inputType: 'insertFromPaste',
			}));
		} catch (error) {
			editor.dispatchEvent(new Event('input', { bubbles: true }));
		}
	} finally {
		programmaticEditorUpdates.delete(editor);
	}
}

function normalizeEditorText(value: string): string {
	return value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+$/g, '').trim();
}

function normalizeComposerMatch(value: string): string {
	return normalizeEditorText(value).replace(/[•\s]+/g, '').toLowerCase();
}

function composerContentMatches(editor: HTMLElement, content: ComposerContent): boolean {
	return normalizeComposerMatch(readEditorText(editor)) === normalizeComposerMatch(content.matchText);
}

function stabilizeEditorContent(editor: HTMLElement, content: ComposerContent) {
	requestAnimationFrame(() => {
		if (!editor.isConnected ||
		composerContentMatches(editor, content)) return;
		replaceContentEditableChildren(editor, content.html);
		editor.classList.toggle('ql-blank', !content.text);
		dispatchEditorInput(editor, content.text);
	});
}

function markdownToComposerContent(source: string): ComposerContent {
	const publishableSource = source
		.replace(/!\[([^\]]*)\]\(les-image:[^)]+\)/g, '')
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
	const html = DOMPurify.sanitize(markdown(publishableSource), {
		ALLOWED_TAGS: [
			'a', 'b', 'blockquote', 'br', 'code', 'del', 'em',
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'i', 'li',
			'ol', 'p', 'pre', 's', 'strong', 'u', 'ul',
		],
		ALLOWED_ATTR: ['href', 'title'],
	});
	const matchSurface = document.createElement('div');
	matchSurface.innerHTML = html;
	return {
		html,
		text: markdownToComposerText(source),
		matchText: matchSurface.textContent || '',
	};
}

function markdownToComposerText(source: string): string {
	return source
		.replace(/!\[([^\]]*)\]\(les-image:[^)]+\)/g, '')
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => (
			label === url ? url : `${label} (${url})`
		))
		.replace(/^```[^\n]*\n?/gm, '')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^\s*[-*+]\s+/gm, '• ')
		.replace(/^>\s?/gm, '')
		.replace(/(\*\*|__)(.*?)\1/g, '$2')
		.replace(/(\*|_)(.*?)\1/g, '$2')
		.replace(/~~(.*?)~~/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function renderDraftPreview(draft: Draft, preview: HTMLElement) {
	if (!draft.body.trim()) {
		preview.textContent = 'Markdown preview';
		preview.classList.add('les-post-drafts-preview-empty');
		return;
	}
	preview.classList.remove('les-post-drafts-preview-empty');
	const source = draft.body.replace(
		/!\[([^\]]*)\]\(les-image:([^)]+)\)/g,
		(match, alt, imageId) => {
			const image = draft.images.find(candidate => candidate.id === imageId);
			return image ? `![${alt}](${image.dataURL})` : '';
		},
	);
	preview.innerHTML = DOMPurify.sanitize(markdown(source));
	for (const link of preview.querySelectorAll('a')) {
		link.setAttribute('target', '_blank');
		link.setAttribute('rel', 'noopener noreferrer');
	}
}

function renderDraftImages(draft: Draft, imageList: HTMLElement) {
	imageList.textContent = '';
	imageList.hidden = !draft.images.length;
	for (const image of draft.images) {
		const row = document.createElement('div');
		const thumbnail = document.createElement('img');
		const name = document.createElement('span');
		const remove = document.createElement('button');
		thumbnail.src = image.dataURL;
		thumbnail.alt = '';
		name.textContent = image.name;
		remove.type = 'button';
		remove.dataset.action = 'remove-image';
		remove.dataset.imageId = image.id;
		remove.textContent = 'Remove';
		row.append(thumbnail, name, remove);
		imageList.append(row);
	}
}

function applyMarkdownFormat(format: string) {
	if (!manager) return;
	const textarea = manager.querySelector('[data-field="body"]');
	if (!(textarea instanceof HTMLTextAreaElement)) return;
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const selected = textarea.value.slice(start, end);
	let replacement = selected;
	let selectionStart = start;
	let selectionEnd = end;

	switch (format) {
		case 'bold':
			replacement = `**${selected || 'bold text'}**`;
			selectionStart = start + 2;
			selectionEnd = selectionStart + (selected || 'bold text').length;
			break;
		case 'italic':
			replacement = `_${selected || 'italic text'}_`;
			selectionStart = start + 1;
			selectionEnd = selectionStart + (selected || 'italic text').length;
			break;
		case 'link': {
			const label = selected || 'link text';
			replacement = `[${label}](https://)`;
			selectionStart = start + replacement.length - 1;
			selectionEnd = selectionStart;
			break;
		}
		case 'list':
			replacement = (selected || 'list item')
				.split('\n')
				.map(line => `- ${line}`)
				.join('\n');
			selectionStart = start;
			selectionEnd = start + replacement.length;
			break;
		default:
			return;
	}

	textarea.setRangeText(replacement, start, end, 'end');
	textarea.setSelectionRange(selectionStart, selectionEnd);
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	textarea.focus();
}

async function addDraftImages(files: File[]) {
	flushManagerDraft();
	const draft = drafts.find(item => item.id === activeDraftId);
	if (!draft) return;
	const available = MAX_DRAFT_IMAGES - draft.images.length;
	if (available <= 0) {
		setManagerStatus(`A draft can contain up to ${MAX_DRAFT_IMAGES} images`);
		return;
	}

	const accepted = files
		.filter(file => file.type.startsWith('image/') && file.size <= MAX_IMAGE_BYTES)
		.slice(0, available);
	if (!accepted.length) {
		setManagerStatus('Choose an image smaller than 10 MB');
		return;
	}

	const images = await Promise.all(accepted.map(async file => ({
		id: createDraftId(Date.now()),
		name: file.name,
		type: file.type,
		dataURL: await readFileAsDataURL(file),
	})));
	draft.images.push(...images);
	const imageMarkdown = images
		.map(image => `![${sanitizeMarkdownLabel(image.name)}](les-image:${image.id})`)
		.join('\n');
	draft.body = [draft.body.trimEnd(), imageMarkdown].filter(Boolean).join('\n\n');
	draft.updatedAt = Date.now();
	await persistDrafts();
	setManagerStatus(`Added ${images.length} image${images.length === 1 ? '' : 's'}`);
}

function readFileAsDataURL(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener('load', () => resolve(String(reader.result || '')));
		reader.addEventListener('error', () => reject(reader.error));
		reader.readAsDataURL(file);
	});
}

function sanitizeMarkdownLabel(value: string): string {
	return value.replace(/[\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function removeDraftImage(imageId: ?string) {
	if (!imageId) return;
	flushManagerDraft();
	const draft = drafts.find(item => item.id === activeDraftId);
	if (!draft) return;
	draft.images = draft.images.filter(image => image.id !== imageId);
	const escapedId = imageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	draft.body = draft.body
		.replace(new RegExp(`!?\\[[^\\]]*\\]\\(les-image:${escapedId}\\)\\n*`, 'g'), '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	draft.updatedAt = Date.now();
	await persistDrafts();
	setManagerStatus('Image removed');
}

function attachDraftImagesToComposer(editor: HTMLElement, draft: Draft): boolean {
	if (!draft.images.length || typeof DataTransfer !== 'function' || typeof DragEvent !== 'function') {
		return false;
	}
	const container = findComposerContainer(editor);
	const dropTarget = container && (
		container.querySelector('.media-modifiers-drag-and-drop__dropzone') ||
		container.querySelector('[class*="drag-and-drop__dropzone"]')
	);
	if (!(dropTarget instanceof HTMLElement)) return false;

	try {
		const transfer = new DataTransfer();
		for (const image of draft.images) transfer.items.add(dataURLToFile(image));
		for (const type of ['dragenter', 'dragover', 'drop']) {
			dropTarget.dispatchEvent(new DragEvent(type, {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
			}));
		}
		return true;
	} catch (error) {
		console.warn('Unable to attach LES draft images:', error);
		return false;
	}
}

function dataURLToFile(image: DraftImage): File {
	const parts = image.dataURL.split(',');
	const metadata = parts[0] || '';
	const encoded = parts[1] || '';
	const mimeMatch = metadata.match(/^data:([^;]+);base64$/);
	const mime = mimeMatch ? mimeMatch[1] : image.type;
	const binary = atob(encoded);
	const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
	return new File([bytes], image.name, { type: mime });
}

function setToolbarStatus(toolbar: HTMLElement, message: string) {
	const status = toolbar.querySelector('[role="status"]');
	if (status) status.textContent = message;
}

function refreshToolbars() {
	for (const toolbar of document.querySelectorAll(`.${TOOLBAR_CLASS}`)) {
		if (!(toolbar instanceof HTMLElement)) continue;
		const button = toolbar.querySelector('[data-action="toggle"]');
		if (button) button.textContent = `Drafts (${drafts.length})`;
		renderPicker(toolbar);
	}
}

function mountManager() {
	if (manager) return;
	manager = string.html`
		<div class="${MANAGER_CLASS}" data-les-ignore="true" data-editor-view="split" hidden>
			<section role="dialog" aria-modal="true" aria-label="LES post drafts">
				<header>
					<div class="les-post-drafts-heading">
						<span class="les-post-drafts-mark" aria-hidden="true">LES</span>
						<div>
							<strong>Post drafts</strong>
							<span>Private composition workspace</span>
						</div>
					</div>
					<div class="les-post-drafts-header-actions">
						<button type="button" data-action="capture">Capture from LinkedIn</button>
						<button type="button" data-action="new" class="les-post-drafts-primary">New draft</button>
						<button type="button" data-action="close" class="les-post-drafts-close" aria-label="Close post drafts">&times;</button>
					</div>
				</header>
				<div class="les-post-drafts-body">
					<nav aria-label="Saved drafts">
						<div class="les-post-drafts-sidebar-heading">
							<strong>Drafts</strong>
							<span class="les-post-drafts-count"></span>
						</div>
						<div class="les-post-drafts-list"></div>
					</nav>
					<main>
						<div class="les-post-drafts-empty">
							<span class="les-post-drafts-empty-mark" aria-hidden="true">D</span>
							<strong>Start a new post</strong>
							<span>Write here or capture the text from LinkedIn's open composer.</span>
							<button type="button" data-action="new" class="les-post-drafts-primary">Create draft</button>
						</div>
						<div class="les-post-drafts-editor" hidden>
							<label class="les-post-drafts-title-field">
								<span>Draft title</span>
								<input type="text" data-field="title" maxlength="120" placeholder="Give this draft a clear name" />
							</label>
							<div class="les-post-drafts-formatbar" role="toolbar" aria-label="Markdown formatting">
								<div class="les-post-drafts-format-actions">
									<button type="button" data-format="bold" title="Bold (Ctrl+B)" aria-label="Bold"><strong>B</strong></button>
									<button type="button" data-format="italic" title="Italic (Ctrl+I)" aria-label="Italic"><em>I</em></button>
									<button type="button" data-format="link" title="Link (Ctrl+K)">Link</button>
									<button type="button" data-format="list" title="Bulleted list">List</button>
								</div>
								<button type="button" data-action="image" title="Add images">Add media</button>
								<input type="file" data-field="images" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden />
								<div class="les-post-drafts-view-actions" role="group" aria-label="Editor view">
									<button type="button" data-view="compose" aria-pressed="false">Write</button>
									<button type="button" data-view="split" aria-pressed="true">Split</button>
									<button type="button" data-view="preview" aria-pressed="false">Preview</button>
								</div>
							</div>
							<div class="les-post-drafts-compose">
								<section>
									<div class="les-post-drafts-pane-heading">
										<strong>Compose</strong>
										<span class="les-post-drafts-character-count"></span>
									</div>
									<label class="les-post-drafts-body-field">
										<span>Post body</span>
										<textarea data-field="body" rows="14" spellcheck="true" placeholder="What do you want to talk about?"></textarea>
									</label>
								</section>
								<section>
									<div class="les-post-drafts-pane-heading">
										<strong>Preview</strong>
										<span>Rendered draft</span>
									</div>
									<div class="les-post-drafts-preview" aria-label="Post preview" tabindex="0"></div>
								</section>
							</div>
							<div class="les-post-drafts-images"></div>
							<footer>
								<button type="button" data-action="delete">Delete</button>
								<div class="les-post-drafts-footer-info">
									<span role="status" aria-live="polite"></span>
									<div class="les-post-drafts-meta"></div>
								</div>
								<div class="les-post-drafts-footer-actions">
									<button type="button" data-action="save">Save draft</button>
									<button type="button" data-action="use">Use in LinkedIn</button>
								</div>
							</footer>
						</div>
					</main>
				</div>
			</section>
		</div>
	`;
	document.body.append(manager);
	manager.addEventListener('click', handleManagerClick);
	manager.addEventListener('input', handleManagerInput);
	manager.addEventListener('change', handleManagerChange);
	manager.addEventListener('keydown', handleEditorKeydown);
	manager.addEventListener('click', (event: MouseEvent) => {
		if (event.target === manager) closeManager();
	});
	document.addEventListener('keydown', (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		closePickers();
		if (manager && !manager.hidden) closeManager();
	});
	document.addEventListener('click', (event: MouseEvent) => {
		if (!(event.target instanceof Element) || !event.target.closest(`.${TOOLBAR_CLASS}`)) closePickers();
	}, true);
}

function openManager(editor: ?HTMLElement) {
	if (!manager) mountManager();
	if (!manager) return;
	activeEditor = editor && isVisibleComposerEditor(editor) ? editor : findActiveComposerEditor();
	const dialog = activeEditor && activeEditor.closest('[role="dialog"], .artdeco-modal');
	if (dialog instanceof HTMLElement) dialog.append(manager);
	if (!activeDraftId || !drafts.some(draft => draft.id === activeDraftId)) activeDraftId = drafts[0] && drafts[0].id;
	manager.hidden = false;
	document.documentElement.classList.add('les-post-drafts-open');
	renderManager();
	const focusTarget = manager.querySelector(activeDraftId ? '[data-field="body"]' : '[data-action="new"]');
	if (focusTarget instanceof HTMLElement) focusTarget.focus();
}

function closeManager() {
	if (!manager) return;
	flushManagerDraft();
	manager.hidden = true;
	if (manager.parentElement !== document.body) document.body.append(manager);
	document.documentElement.classList.remove('les-post-drafts-open');
}

function renderManager() {
	if (!manager) return;
	const list = manager.querySelector('.les-post-drafts-list');
	if (!(list instanceof HTMLElement)) return;
	list.textContent = '';
	const count = manager.querySelector('.les-post-drafts-count');
	if (count) count.textContent = `${drafts.length} saved`;

	for (const draft of drafts) {
		const item = string.html`
			<button type="button" data-draft-id="${draft.id}" aria-current="${draft.id === activeDraftId ? 'true' : 'false'}">
				<strong>${draft.title}</strong>
				<span>${new Date(draft.updatedAt).toLocaleString()}</span>
			</button>
		`;
		list.append(item);
	}

	const draft = drafts.find(item => item.id === activeDraftId);
	const empty = manager.querySelector('.les-post-drafts-empty');
	const editor = manager.querySelector('.les-post-drafts-editor');
	if (!(empty instanceof HTMLElement) || !(editor instanceof HTMLElement)) return;
	empty.hidden = !!draft;
	editor.hidden = !draft;
	if (!draft) return;

	const title = editor.querySelector('[data-field="title"]');
	const body = editor.querySelector('[data-field="body"]');
	const meta = editor.querySelector('.les-post-drafts-meta');
	const preview = editor.querySelector('.les-post-drafts-preview');
	const imageList = editor.querySelector('.les-post-drafts-images');
	if (title instanceof HTMLInputElement && title !== document.activeElement) title.value = draft.title;
	if (body instanceof HTMLTextAreaElement && body !== document.activeElement) body.value = draft.body;
	if (preview instanceof HTMLElement) renderDraftPreview(draft, preview);
	if (imageList instanceof HTMLElement) renderDraftImages(draft, imageList);
	updateEditorMetrics(draft);
	if (meta) {
		meta.textContent = `${markdownToComposerText(draft.body).length} publishable characters - ${draft.images.length} image${draft.images.length === 1 ? '' : 's'} - updated ${new Date(draft.updatedAt).toLocaleString()}`;
	}
}

function handleManagerClick(event: Event) {
	const target = event.target instanceof Element && event.target.closest('button');
	if (!(target instanceof HTMLButtonElement)) return;
	if (target.dataset.view) {
		setEditorView(target.dataset.view);
		return;
	}
	if (target.dataset.format) {
		applyMarkdownFormat(target.dataset.format);
		return;
	}
	const draftId = target.dataset.draftId;
	if (draftId) {
		flushManagerDraft();
		activeDraftId = draftId;
		renderManager();
		return;
	}

	switch (target.dataset.action) {
		case 'close':
			closeManager();
			break;
		case 'new': {
			flushManagerDraft();
			const draft = createDraft();
			drafts.unshift(draft);
			activeDraftId = draft.id;
			persistDrafts();
			break;
		}
		case 'capture':
			if (activeEditor) captureEditor(activeEditor, findToolbar(activeEditor));
			break;
		case 'image': {
			const input = manager && manager.querySelector('[data-field="images"]');
			if (input instanceof HTMLInputElement) input.click();
			break;
		}
		case 'remove-image':
			removeDraftImage(target.dataset.imageId);
			break;
		case 'save':
			flushManagerDraft(true);
			break;
		case 'use':
			useActiveDraft();
			break;
		case 'delete':
			deleteActiveDraft();
			break;
		default:
			break;
	}
}

function handleManagerInput(event: Event) {
	const target = event.target;
	if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
	if (!target.dataset.field) return;
	const draft = drafts.find(item => item.id === activeDraftId);
	if (draft && target.dataset.field === 'body') {
		draft.body = target.value;
		const preview = manager && manager.querySelector('.les-post-drafts-preview');
		if (preview instanceof HTMLElement) renderDraftPreview(draft, preview);
		updateEditorMetrics(draft);
	}
	if (draft && target.dataset.field === 'title') draft.title = target.value;
	if (managerSaveTimer) clearTimeout(managerSaveTimer);
	managerSaveTimer = setTimeout(() => flushManagerDraft(), 500);
}

function setEditorView(view: string) {
	if (!manager || !['compose', 'split', 'preview'].includes(view)) return;
	manager.dataset.editorView = view;
	for (const button of manager.querySelectorAll('[data-view]')) {
		if (button instanceof HTMLButtonElement) {
			button.setAttribute('aria-pressed', String(button.dataset.view === view));
		}
	}
	const focusTarget = manager.querySelector(view === 'preview' ?
		'.les-post-drafts-preview' :
		'[data-field="body"]');
	if (focusTarget instanceof HTMLElement) focusTarget.focus();
}

function updateEditorMetrics(draft: Draft) {
	if (!manager) return;
	const count = markdownToComposerText(draft.body).length;
	const counter = manager.querySelector('.les-post-drafts-character-count');
	if (!(counter instanceof HTMLElement)) return;
	counter.textContent = `${count.toLocaleString()} / ${LINKEDIN_POST_CHARACTER_LIMIT.toLocaleString()}`;
	counter.classList.toggle('les-post-drafts-character-count-over', count > LINKEDIN_POST_CHARACTER_LIMIT);
}

function handleEditorKeydown(event: KeyboardEvent) {
	const target = event.target;
	if (!(target instanceof HTMLTextAreaElement) || target.dataset.field !== 'body') return;
	if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
	let format;
	switch (event.key.toLowerCase()) {
		case 'b':
			format = 'bold';
			break;
		case 'i':
			format = 'italic';
			break;
		case 'k':
			format = 'link';
			break;
		default:
			return;
	}
	if (!format) return;
	event.preventDefault();
	applyMarkdownFormat(format);
}

async function handleManagerChange(event: Event) {
	const input = event.target;
	if (!(input instanceof HTMLInputElement) || input.dataset.field !== 'images' || !input.files?.length) return;
	await addDraftImages(Array.from(input.files));
	input.value = '';
}

function flushManagerDraft(showStatus: boolean = false) {
	if (!manager || !activeDraftId) return;
	if (managerSaveTimer) clearTimeout(managerSaveTimer);
	managerSaveTimer = null;
	const draft = drafts.find(item => item.id === activeDraftId);
	const title = manager.querySelector('[data-field="title"]');
	const body = manager.querySelector('[data-field="body"]');
	if (!draft || !(title instanceof HTMLInputElement) || !(body instanceof HTMLTextAreaElement)) return;

	draft.title = title.value.trim() || titleFromBody(body.value);
	draft.body = body.value;
	draft.updatedAt = Date.now();
	persistDrafts();
	if (showStatus) setManagerStatus('Saved');
}

async function useActiveDraft() {
	flushManagerDraft();
	const draft = drafts.find(item => item.id === activeDraftId);
	if (!draft) return;
	const content = markdownToComposerContent(draft.body);
	const copied = await copyDraftContent(content);
	const editor = activeEditor && activeEditor.isConnected ? activeEditor : findActiveComposerEditor();
	if (!editor) {
		setManagerStatus(copied ? 'Copied; paste into LinkedIn' : 'Open LinkedIn\'s post composer first');
		return;
	}

	const loaded = replaceEditorContent(editor, content);
	if (!loaded) {
		setManagerStatus(copied ? 'Copied; paste into LinkedIn' : 'LinkedIn rejected the draft text');
		return;
	}
	activeEditor = editor;
	editor.dataset.lesPostDraftId = draft.id;
	const attached = attachDraftImagesToComposer(editor, draft);
	const action = copied ? 'Copied and loaded' : 'Loaded';
	setManagerStatus(attached ?
		`${action} text and images into LinkedIn` :
		`${action} into LinkedIn${draft.images.length ? '; add saved images with Add media' : ''}`);
	closeManager();
}

function deleteActiveDraft() {
	const draft = drafts.find(item => item.id === activeDraftId);
	if (!draft || !window.confirm(`Delete "${draft.title}"?`)) return;
	drafts = drafts.filter(item => item.id !== draft.id);
	activeDraftId = drafts[0] && drafts[0].id;
	persistDrafts();
}

function setManagerStatus(message: string) {
	if (!manager) return;
	const status = manager.querySelector('.les-post-drafts-editor [role="status"]');
	if (status) status.textContent = message;
}

function findToolbar(editor: HTMLElement): HTMLElement {
	const container = findComposerContainer(editor);
	const toolbar = container && container.querySelector(`.${TOOLBAR_CLASS}`);
	return toolbar instanceof HTMLElement ? toolbar : editor;
}

function startObserver() {
	const target = document.body || document.documentElement;
	if (!target) return;
	const observer = new MutationObserver(records => {
		for (const record of records) {
			positionPortalToolbar();
			const mutationTarget = record.target;
			if (mutationTarget instanceof HTMLElement &&
			mutationTarget.matches('.share-creation-state__additional-toolbar') &&
			(!portalToolbar || portalActionRow !== mutationTarget)) {
				setTimeout(() => scanNativeToolbars(mutationTarget), 0);
			}
			for (const node of record.addedNodes) {
				if (!(node instanceof HTMLElement)) continue;
				scanEditors(node);
				const controls = node.matches('button, [role="button"]') ?
					[node] :
					Array.from(node.querySelectorAll('button, [role="button"]'));
				const actionControl = controls.find(control => (
					COMPOSER_ACTION_PATTERN.test(controlText(control)) ||
					/^post$/i.test(controlText(control))
				));
				if (actionControl instanceof Element) {
					const surface = findComposerSurfaceFromControl(actionControl);
					if (surface) scanEditors(surface);
				}
			}
		}
	});
	observer.observe(target, { childList: true, subtree: true });
}
