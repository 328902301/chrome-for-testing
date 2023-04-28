/**
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// This script gets Chrome release version numbers per platform
// from the Chromium Dash API, figures out the most appropriate version
// number to use for bundling with Puppeteer, and prints its download
// URLs + their HTTP status codes.

import fs from 'node:fs/promises';

// Lorry download bucket labels.
const platforms = new Set([
	'linux64',
	'mac-arm64',
	'mac-x64',
	'win32',
	'win64',
]);

const makeDownloadUrl = ({ version, platform }) => {
	const url = `https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/${version}/${platform}/chrome-${platform}.zip`;
	return url;
};

// Why pull in `semver.lt()` when we could instead we can have some fun?
const reVersionNumber = /^(?<major>\d+)\.(?<minor>\d+)\.(?<build>\d+).(?<patch>\d+)$/;
const hash = (versionNumber) => {
	// XXXXX.XXXXX.XXXXX.XXXXX
	//       00000 00000 00000
	//             00000 00000
	//                   00000
	const match = reVersionNumber.exec(versionNumber);
	const major = BigInt(match.groups.major);
	const minor = BigInt(match.groups.minor);
	const build = BigInt(match.groups.build);
	const patch = BigInt(match.groups.patch);
	const hashed =
		major * 1_00000_00000_00000n
		+ minor *     1_00000_00000n
		+ build *           1_00000n
		+ patch;
	return hashed;
};
const isOlderVersion = (a, b) => {
	return hash(a) < hash(b);
};

const findVersionForChannel = async (channel = 'Stable') => {
	const result = {
		channel,
		version: '0.0.0.0',
		revision: '0',
		ok: false,
		downloads: [], // {platform, url, status}
	};
	console.log(`Checking the ${channel} channel…`);
	const apiEndpoint = `https://chromiumdash.appspot.com/fetch_releases?channel=${channel}&num=1&platform=Win32,Windows,Mac,Linux`;
	const response = await fetch(apiEndpoint);
	const data = await response.json();

	let minVersion = `99999.99999.99999.99999`;
	const versions = new Set();
	let minRevision = 9999999999999999;
	for (const entry of data) {
		const version = entry.version;
		const revision = String(entry.chromium_main_branch_position);
		versions.add(version);
		if (isOlderVersion(version, minVersion)) {
			minVersion = version;
			minRevision = revision;
		}
	}

	console.log(`Found versions:`, versions);
	console.log(`Recommended version for ${channel} channel:`, minVersion);
	result.version = minVersion;
	result.revision = minRevision;

	const urls = [];
	for (const platform of platforms) {
		const url = makeDownloadUrl({
			version: minVersion,
			platform,
		});
		urls.push({ platform, url });
	}

	let hasFailure = false;
	for (const { platform, url } of urls) {
		const response = await fetch(url, { method: 'head' });
		const status = response.status;
		if (status !== 200) {
			hasFailure = true;
		}
		result.downloads.push({ platform, url, status })
		console.log(url, status);
	}
	console.log(hasFailure ? '\u274C NOT OK' : '\u2705 OK');
	result.ok = !hasFailure;
	return result;
};

const allResults = {
	timestamp: new Date().toISOString(),
	channels: {},
};
allResults.channels.Stable = await findVersionForChannel('Stable');
console.log('');
allResults.channels.Beta = await findVersionForChannel('Beta');
console.log('');
allResults.channels.Dev = await findVersionForChannel('Dev');
console.log('');
allResults.channels.Canary = await findVersionForChannel('Canary');

const json = JSON.stringify(allResults, null, '\t');
await fs.writeFile('./data/output.json', `${json}\n`);
