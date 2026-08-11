/* @flow */

import test from 'ava';

import { getBatchSize, getThreshold, meetsThreshold, parseMutualCount } from '../autoConnectUtils.js';

test('parses mutual connection counts', t => {
	t.is(parseMutualCount('25 mutual connections'), 25);
	t.is(parseMutualCount('1,250 shared connections'), 1250);
	t.is(parseMutualCount('25 mutuals'), 25);
	t.is(parseMutualCount('Aravind and 57 other mutual connections'), 57);
	t.is(parseMutualCount('Aravind & 1 other shared connection'), 1);
	t.is(parseMutualCount('Aravindand 57 other mutual connections'), 57);
	t.is(parseMutualCount('12 other mutual connections'), 12);
	t.is(parseMutualCount('348othermutualconnections'), 348);
	t.is(parseMutualCount('1,250\u200b other\u200b mutual\u200b connections'), 1250);
	t.is(parseMutualCount('No shared connections'), null);
});

test('normalizes thresholds and batch sizes', t => {
	t.is(getThreshold('25'), 25);
	t.is(getThreshold('0'), 0);
	t.is(getThreshold('not a number'), 25);
	t.is(getBatchSize('25'), 25);
	t.is(getBatchSize('0'), 1);
	t.is(getBatchSize('not a number'), 25);
	t.true(meetsThreshold(25, '25'));
	t.true(meetsThreshold(24, '25'));
	t.false(meetsThreshold(26, '25'));
});
