/* @noflow */
/* eslint import/no-nodejs-modules: 0, import/extensions: 0 */

import fs from 'node:fs';
import path from 'node:path';
import * as commander from 'commander';
import * as esbuild from 'esbuild';
import * as semver from 'semver';
import JSZip from 'jszip';
import flowRemoveTypes from 'flow-remove-types';
import { copy } from 'esbuild-plugin-copy';
import { sassPlugin } from 'esbuild-sass-plugin';
import isBetaVersion from './build/isBetaVersion.js';
import packageInfo from './package.json' with { type: 'json' };

const targets = {
	chrome: {
		browserName: 'chrome',
		browserMinVersion: '114.0',
		manifest: './chrome/manifest.json',
	},
	chromebeta: {
		browserName: 'chrome',
		browserMinVersion: '114.0',
		manifest: './chrome/beta/manifest.json',
	},
	edge: {
		browserName: 'edge',
		browserMinVersion: '114.0',
		manifest: './chrome/manifest.json',
	},
	opera: {
		browserName: 'opera',
		browserMinVersion: '114.0',
		manifest: './chrome/manifest.json',
		noSourcemap: true,
	},
	firefox: {
		browserName: 'firefox',
		browserMinVersion: '115.0',
		browserMobileMinVersion: '120.0',
		manifest: './firefox/manifest.json',
		noSourcemap: true,
	},
}

const options = commander.program
	.option('--watch', 'Enable watch mode')
	.option('--zip', 'Enable zipping')
	.option('--mode <type>', 'Set the mode', 'development')
	.option('--browsers <list>', 'Specify browsers to target', 'chrome')
	.option('--increment-version [release]', 'Increment package.json version before building (patch, minor, major, prerelease, or an explicit semver version)')
	.parse(process.argv)
	.opts();

if (options.incrementVersion) {
	packageInfo.version = incrementPackageVersion(options.incrementVersion);
}

const isProduction = options.mode === 'production';
const devBuildToken = `${Math.random()}`.slice(2);
const name /*: string */ = packageInfo.title;
const author /*: string */ = packageInfo.author;
const description /*: string */ = packageInfo.description;
const version /*: string */ = packageInfo.version;
const isBeta /*: boolean */ = isBetaVersion(version);
const isPatch /*: boolean */ = semver.patch(version) !== 0;
const isMinor /*: boolean */ = !isPatch && semver.minor(version) !== 0;
const isMajor /*: boolean */ = !isPatch && !isMinor && semver.major(version) !== 0;
const homepageURL /*: string */ = packageInfo.homepage;
const updatedURL /*: string */ = `${homepageURL}/releases#v${version}`;
// used for invalidating caches on each build (executed at build time)
// production builds uses version number to keep the build reproducible
const buildToken = isProduction ? version : devBuildToken;

function incrementPackageVersion(release) {
	const releaseType = release === true ? 'patch' : release;
	const nextVersion = semver.valid(releaseType) || semver.inc(packageInfo.version, releaseType);

	if (!nextVersion) {
		throw new Error(`Invalid version increment: ${releaseType}`);
	}

	const packagePath = new URL('./package.json', import.meta.url);
	const packageText = fs.readFileSync(packagePath, 'utf8');
	const packageJson = JSON.parse(packageText);
	packageJson.version = nextVersion;
	fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
	console.log(`incremented package version ${packageInfo.version} -> ${nextVersion}`);

	return nextVersion;
}

async function buildForBrowser(targetName, { manifest, noSourceMap, browserName, browserMinVersion, browserMobileMinVersion }) {
	const context = {
		entryPoints: {
			'foreground.entry': './lib/foreground.entry.js',
			'background.entry': './lib/background.entry.js',
			'options.entry': './lib/options/options.entry.js',
			'prompt.entry': './lib/environment/background/permissions/prompt.entry.js',
			manifest,
			options: './lib/options/options.scss',
			res: './lib/css/res.scss',
		},
		sourcemap: !isProduction || !noSourceMap,
		outdir: `./dist/${targetName}/`,
		bundle: true,
		format: 'iife',
		treeShaking: true,
		metafile: true,
		target: [`${browserName}${browserMinVersion}`],
		loader: {
			'.svg': 'dataurl',
			'.gif': 'dataurl',
			'.png': 'dataurl',
			'.woff': 'dataurl',
		},
		define: {
			'process.env.BUILD_TARGET': `"${browserName}"`,
			'process.env.NODE_ENV': `"${options.mode}"`,
			'process.env.buildToken': `"${buildToken}"`,
			'process.env.name': `"${name}"`,
			'process.env.author': `"${author}"`,
			'process.env.description': `"${description}"`,
			'process.env.version': `"${version}"`,
			'process.env.isBeta': `"${isBeta.toString()}"`,
			'process.env.isPatch': `"${isPatch.toString()}"`,
			'process.env.isMinor': `"${isMinor.toString()}"`,
			'process.env.isMajor': `"${isMajor.toString()}"`,
			'process.env.updatedURL': `"${updatedURL}"`,
			'process.env.homepageURL': `"${homepageURL}"`,
		},
		plugins: [
			{
				name: 'remove-flow-types',
				setup(build) {
					build.onLoad({ filter: /\.m?js$/ }, async args => {
						const text = await fs.promises.readFile(args.path, 'utf8')
						const contents = flowRemoveTypes(text, { pretty: true }).toString();
						return {
							contents,
							loader: 'js',
						}
					})
				},
			},
			sassPlugin(),
			copy({
				assets: [
					{ from: ['./LICENSE'], to: ['./'] },
					{ from: ['./images/css-off-small.png'], to: ['./'] },
					{ from: ['./images/css-off.png'], to: ['./'] },
					{ from: ['./images/css-on-small.png'], to: ['./'] },
					{ from: ['./images/css-on.png'], to: ['./'] },
					{ from: ['./images/icon128.png'], to: ['./'] },
					{ from: ['./images/icon48.png'], to: ['./'] },
					{ from: ['./chrome/rules/telemetry.json'], to: ['./rules/'] },
					{ from: ['./lib/environment/background/permissions/prompt.html'], to: ['./'] },
					{ from: ['./lib/options/options.html'], to: ['./'] },
					{ from: ['./node_modules/dashjs/dist/dash.mediaplayer.min.js'], to: ['./'] },
				],
			}),
			{
				name: 'build-manifest',
				setup(build) {
					build.onLoad({ filter: /manifest\.json$/ }, async args => {
						let text = await fs.promises.readFile(args.path, 'utf8')
						const replace = {
							__version__: version,
							__name__: name,
							__description__: description,
							__homepage__: homepageURL,
							__author__: author,
							__browser_min_version__: browserMinVersion,
							__browser_mobile_min_version__: browserMobileMinVersion,
						}
						Object.keys(replace).forEach(v => {
							text = text.replaceAll(v, replace[v]);
						});
						JSON.parse(text); // Check if resulting JSON is valid
						return { contents: text, loader: 'copy' };
					});
				},
			}, options.zip ? {
				name: 'zip-build',
				setup(build) {
					const sourceDir = `./dist/${targetName}/`;
					const outPath = './dist/zip';
					build.onEnd(async () => {
						const zip = new JSZip();

						await addDirectoryToZip(zip, sourceDir);

						const zipContent = await zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
						await fs.promises.mkdir(outPath, { recursive: true })
						await fs.promises.writeFile(`${outPath}/${targetName}.zip`, zipContent);
						console.log(`emitted zip file for ${targetName}`);
					})
				},
			} : undefined,
		].filter(Boolean),
	};

	if (options.watch) {
		console.log(`Watching ${targetName}; break to exit`);
		const ctx = await esbuild.context(context);
		await ctx.watch();
	} else {
		console.log(`building ${targetName}`);
		const result = await esbuild.build(context)
		fs.writeFileSync(`dist/esbuild-meta-${targetName}.json`, JSON.stringify(result.metafile))
	}
}

async function addDirectoryToZip(zip, sourceDir, zipDir = '') {
	const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

	await Promise.all(entries.map(async entry => {
		const filePath = path.join(sourceDir, entry.name);
		const zipPath = zipDir ? `${zipDir}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			await addDirectoryToZip(zip, filePath, zipPath);
			return;
		}

		if (!entry.isFile()) return;

		const content = await fs.promises.readFile(filePath);
		zip.file(zipPath, content);
	}));
}

let buildTargets = options.browsers;
// browser option `all` converts to all available targets
buildTargets = [...new Set(buildTargets.replace('all', Object.keys(targets).join(',')).split(','))];
buildTargets.map(v => buildForBrowser(v, targets[v]));
