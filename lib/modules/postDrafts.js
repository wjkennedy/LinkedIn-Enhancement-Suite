/* @flow */

import { Module } from '../core/module';
import { Storage } from '../environment';
import { string } from '../utils';
import { isLinkedInHost } from '../utils/linkedin';

export const module: Module<*> = new Module('postDrafts');

type Draft = {|
	id: string,
	title: string,
	body: string,
	createdAt: number,
	updatedAt: number,
|};

const STORAGE_KEY = 'LES.postDrafts';
const MAX_DRAFTS = 50;
const TOOLBAR_CLASS = 'les-post-drafts-toolbar';
const TOOLBAR_PORTAL_CLASS = 'les-post-drafts-toolbar-portal';
const PICKER_CLASS = 'les-post-drafts-picker';
const MANAGER_CLASS = 'les-post-drafts-manager';
const COMPOSER_ACTION_PATTERN = /\b(?:emoji|enhance post|add media|more|celebrat|expert)\b/i;
const EDITOR_SELECTOR = [
	'[contenteditable]:not([contenteditable="false"])',
	'textarea[aria-label*="post" i]',
	'textarea[placeholder*="post" i]',
].join(', ');

const storage = Storage.wrap(STORAGE_KEY, ([]: Draft[]));
const editorSaveTimers: WeakMap<HTMLElement, TimeoutID> = new WeakMap();
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
module.description = 'Create, edit, and restore multiple local text drafts from the LinkedIn post composer.';
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
		typeof draft.updatedAt === 'number') normalized.push(draft);
	}
	return normalized.slice(0, MAX_DRAFTS);
}

function createDraft(body: string = ''): Draft {
	const now = Date.now();
	return {
		id: createDraftId(now),
		title: titleFromBody(body),
		body,
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
			if (currentEditor) loadDraftIntoEditor(button.dataset.draftId, currentEditor, toolbar);
			else setToolbarStatus(toolbar, 'Composer editor not found');
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
	if (fallback && fallback.isConnected) {
		bindEditorAutosave(fallback, toolbar);
		return fallback;
	}
	const editor = findEditorNearSurface(toolbar);
	if (editor) bindEditorAutosave(editor, toolbar);
	return editor;
}

function bindEditorAutosave(editor: HTMLElement, toolbar: HTMLElement) {
	editor.dataset.lesPostDraftsMounted = 'true';
	if (editor.dataset.lesPostDraftsAutosaveBound === 'true') return;
	editor.dataset.lesPostDraftsAutosaveBound = 'true';
	editor.addEventListener('input', () => {
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

function loadDraftIntoEditor(draftId: string, editor: HTMLElement, toolbar: HTMLElement) {
	const draft = drafts.find(item => item.id === draftId);
	if (!draft) return;
	replaceEditorText(editor, draft.body);
	editor.dataset.lesPostDraftId = draft.id;
	activeDraftId = draft.id;
	closePickers();
	setToolbarStatus(toolbar, `Loaded ${draft.title}`);
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

function replaceEditorText(editor: HTMLElement, body: string) {
	editor.focus();
	if (editor instanceof HTMLTextAreaElement) {
		editor.value = body;
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		editor.dispatchEvent(new Event('change', { bubbles: true }));
		return;
	}
	const selection = window.getSelection();
	if (selection) {
		const range = document.createRange();
		range.selectNodeContents(editor);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	const inserted = document.execCommand('insertText', false, body);
	if (!inserted) {
		editor.textContent = body;
		editor.dispatchEvent(new Event('input', { bubbles: true }));
	}
	editor.dispatchEvent(new Event('change', { bubbles: true }));
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
		<div class="${MANAGER_CLASS}" data-les-ignore="true" hidden>
			<section role="dialog" aria-modal="true" aria-label="LES post drafts">
				<header>
					<div><strong>Post drafts</strong><span>Stored locally by LES</span></div>
					<div>
						<button type="button" data-action="new">New</button>
						<button type="button" data-action="capture">Capture post</button>
						<button type="button" data-action="close" aria-label="Close post drafts">&times;</button>
					</div>
				</header>
				<div class="les-post-drafts-body">
					<nav aria-label="Saved drafts"><div class="les-post-drafts-list"></div></nav>
					<main>
						<div class="les-post-drafts-empty">Create a draft or capture the text in LinkedIn's composer.</div>
						<div class="les-post-drafts-editor" hidden>
							<label>Title<input type="text" data-field="title" maxlength="120" /></label>
							<label>Post<textarea data-field="body" rows="14"></textarea></label>
							<div class="les-post-drafts-meta"></div>
							<footer>
								<button type="button" data-action="delete">Delete</button>
								<span role="status" aria-live="polite"></span>
								<button type="button" data-action="save">Save now</button>
								<button type="button" data-action="use">Use in post</button>
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
	activeEditor = editor;
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
	document.documentElement.classList.remove('les-post-drafts-open');
}

function renderManager() {
	if (!manager) return;
	const list = manager.querySelector('.les-post-drafts-list');
	if (!(list instanceof HTMLElement)) return;
	list.textContent = '';

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
	if (title instanceof HTMLInputElement && title !== document.activeElement) title.value = draft.title;
	if (body instanceof HTMLTextAreaElement && body !== document.activeElement) body.value = draft.body;
	if (meta) meta.textContent = `${draft.body.length} characters - updated ${new Date(draft.updatedAt).toLocaleString()}`;
}

function handleManagerClick(event: Event) {
	const target = event.target instanceof Element && event.target.closest('button');
	if (!(target instanceof HTMLButtonElement)) return;
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
	if (managerSaveTimer) clearTimeout(managerSaveTimer);
	managerSaveTimer = setTimeout(() => flushManagerDraft(), 500);
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

function useActiveDraft() {
	flushManagerDraft();
	const draft = drafts.find(item => item.id === activeDraftId);
	if (!draft || !activeEditor || !document.contains(activeEditor)) {
		setManagerStatus('Open LinkedIn\'s post composer first');
		return;
	}

	replaceEditorText(activeEditor, draft.body);
	activeEditor.dataset.lesPostDraftId = draft.id;
	setManagerStatus('Loaded into LinkedIn');
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
