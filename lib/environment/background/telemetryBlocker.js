/* @flow */

const LINKEDIN_TELEMETRY_URLS = [
	'*://platform.linkedin.com/litms/*',
	'*://*.linkedin.com/li/track*',
	'*://*.linkedin.com/sensorCollect*',
	'*://*.linkedin.com/realtime/realtimeFrontendClientConnectivityTracking*',
];

if (process.env.BUILD_TARGET === 'firefox') {
	chrome.webRequest.onBeforeRequest.addListener(
		() => ({ cancel: true }),
		{ urls: LINKEDIN_TELEMETRY_URLS },
		['blocking'],
	);
}
