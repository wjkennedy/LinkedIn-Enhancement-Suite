/* @flow */

import { sendMessage } from './messaging';

const LINKEDIN_TELEMETRY_URLS = [
	'*://platform.linkedin.com/litms/*',
	'*://*.linkedin.com/li/track*',
	'*://*.linkedin.com/sensorCollect*',
	'*://*.linkedin.com/realtime/realtimeFrontendClientConnectivityTracking*',
];

function reportTelemetryDeflection({ tabId }) {
	if (tabId < 0) return;
	sendMessage('telemetryDeflected', undefined, tabId).catch(() => undefined);
}

if (process.env.BUILD_TARGET === 'firefox') {
	chrome.webRequest.onBeforeRequest.addListener(
		details => {
			reportTelemetryDeflection(details);
			return { cancel: true };
		},
		{ urls: LINKEDIN_TELEMETRY_URLS },
		['blocking'],
	);
} else {
	chrome.webRequest.onBeforeRequest.addListener(
		reportTelemetryDeflection,
		{ urls: LINKEDIN_TELEMETRY_URLS },
	);
}
