/* @flow */

import { RES_DISABLED_HASH, RES_SETTINGS_HASH, RES_SETTINGS_REDIRECT_TO_STANDALONE_HASH } from './constants/urlHashes';
import { init } from './core/init';
import { getURL } from './environment/foreground/id';
import { startAutoConnect } from './modules/autoConnect';
import { startPostDrafts } from './modules/postDrafts';

const blockers = [];

if (location.hash === RES_DISABLED_HASH) {
	blockers.push(`Hash ${RES_DISABLED_HASH} disables LES.`);
} else {
	window.addEventListener('hashchange', () => { if (location.hash === RES_DISABLED_HASH) location.reload(); });
}

// Integration tests are performed quicker when redirected to the standalone options page
if (location.hash.startsWith(RES_SETTINGS_REDIRECT_TO_STANDALONE_HASH)) {
	location.href = getURL(`options.html${location.hash.replace(RES_SETTINGS_REDIRECT_TO_STANDALONE_HASH, RES_SETTINGS_HASH)}`);
	blockers.push('Redirecting to the options page.');
}

// Firefox reloads the extension on all active pages when upgrading
// LES doesn't handle that well
if (document.documentElement && document.documentElement.classList.contains('res')) {
	document.documentElement.setAttribute('res-warning', 'This page must be reloaded for LinkedIn Enhancement Suite to function correctly');
	blockers.push('LES is previously loaded on this page.');
}

if (window !== window.parent && (new URL(location.href)).searchParams.get('embedded') !== 'true') {
	blockers.push('Conditions for running on an embedded page are not met.');
}

if (blockers.length) {
	console.warn('Preventing initalization of LES:', blockers);
} else {
	startPostDrafts();
	startAutoConnect();
	init();
}
