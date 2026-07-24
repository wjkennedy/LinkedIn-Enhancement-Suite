/* @flow */

const STATE_KEY = '__lesExtensionProbeMonitor';
const EVENT_NAME = 'les-extension-probe';
const COUNT_ATTRIBUTE = 'data-les-extension-probe-count';
const UNRESOLVED_ATTRIBUTE = 'data-les-extension-probe-unresolved-count';
const REPORT_DELAY = 100;

function requestURL(input: mixed): string {
	if (typeof input === 'string') return input;
	if (input && typeof input.url === 'string') return input.url;
	if (input && typeof input.href === 'string') return input.href;
	return '';
}

function installMonitor() {
	if (window[STATE_KEY]) return;

	const state = {
		activeCalls: 0,
		count: 0,
		delegates: [window.fetch],
		originalFetch: window.fetch,
		reportTimer: null,
		unresolvedCount: 0,
		wrapper: null,
	};

	function report() {
		state.reportTimer = null;
		const root = document.documentElement;
		if (!root) {
			state.reportTimer = setTimeout(report, 0);
			return;
		}

		root.setAttribute(COUNT_ATTRIBUTE, String(state.count));
		root.setAttribute(UNRESOLVED_ATTRIBUTE, String(state.unresolvedCount));
		document.dispatchEvent(new Event(EVENT_NAME));
	}

	function scheduleReport() {
		if (state.reportTimer) return;
		state.reportTimer = setTimeout(report, REPORT_DELAY);
	}

	function wrapper(...args) {
		if (state.activeCalls === 0) {
			const url = requestURL(args[0]);
			if (/^chrome-extension:\/\//i.test(url)) {
				state.count += 1;
				if (/^chrome-extension:\/\/invalid(?:\/|$)/i.test(url)) state.unresolvedCount += 1;
				scheduleReport();
			}
		}

		const delegateIndex = state.delegates.length - 1 - state.activeCalls;
		const delegate = state.delegates[delegateIndex] || state.originalFetch;
		state.activeCalls += 1;
		try {
			return Reflect.apply(delegate, window, args);
		} finally {
			state.activeCalls -= 1;
		}
	}

	state.wrapper = wrapper;
	window[STATE_KEY] = state;
	try {
		Object.defineProperty(window, 'fetch', {
			configurable: true,
			enumerable: true,
			get: () => wrapper,
			set: value => {
				const current = state.delegates[state.delegates.length - 1];
				if (typeof value === 'function' && value !== wrapper && value !== current) state.delegates.push(value);
			},
		});
	} catch (error) {
		window.fetch = wrapper;
	}
	report();
}

installMonitor();
