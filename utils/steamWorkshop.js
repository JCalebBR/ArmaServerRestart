const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

const WORKSHOP_DETAILS_URL = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
const PROCESS_OUTPUT_LIMIT = 64 * 1024;

function parseMetaCpp(content) {
	if (typeof content !== 'string') return {};

	const nameMatch = content.match(/\bname\s*=\s*"((?:\\.|[^"\\])*)"\s*;/i);
	const timestampMatch = content.match(/\btimestamp\s*=\s*(\d+)\s*;/i);
	const publishedIdMatch = content.match(/\bpublishedid\s*=\s*(\d+)\s*;/i);

	return {
		name: nameMatch ? nameMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null,
		timestamp: timestampMatch ? timestampMatch[1] : null,
		publishedId: publishedIdMatch ? publishedIdMatch[1] : null,
	};
}

function readModMeta(modDirectory, fsModule = fs) {
	try {
		const content = fsModule.readFileSync(path.join(modDirectory, 'meta.cpp'), 'utf8');
		return parseMetaCpp(content);
	} catch (error) {
		if (error.code !== 'ENOENT') console.warn(`[Workshop] Could not read ${modDirectory}\\meta.cpp:`, error.message);
		return {};
	}
}

function discoverWorkshopMods(stagingDirectory, fsModule = fs) {
	return fsModule.readdirSync(stagingDirectory, { withFileTypes: true })
		.filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
		.map(entry => {
			const directory = path.join(stagingDirectory, entry.name);
			return {
				id: entry.name,
				directory,
				meta: readModMeta(directory, fsModule),
			};
		})
		.sort((a, b) => {
			const first = BigInt(a.id);
			const second = BigInt(b.id);
			return first < second ? -1 : first > second ? 1 : 0;
		});
}

function buildDirectoryManifest(directory, fsModule = fs, relativeDirectory = '') {
	const currentDirectory = path.join(directory, relativeDirectory);
	const entries = fsModule.readdirSync(currentDirectory, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name));
	const manifest = [];

	for (const entry of entries) {
		const relativePath = path.join(relativeDirectory, entry.name);
		if (entry.isDirectory()) {
			manifest.push(...buildDirectoryManifest(directory, fsModule, relativePath));
			continue;
		}

		if (!entry.isFile()) continue;
		const stats = fsModule.statSync(path.join(directory, relativePath));
		manifest.push(`${relativePath.toLowerCase()}|${stats.size}|${Math.trunc(stats.mtimeMs)}`);
	}

	return manifest;
}

function workshopItemsMatch(stagingModDirectory, cachedModDirectory, fsModule = fs) {
	const stagingMeta = readModMeta(stagingModDirectory, fsModule);
	const cachedMeta = readModMeta(cachedModDirectory, fsModule);

	if (stagingMeta.timestamp && cachedMeta.timestamp) {
		return stagingMeta.timestamp === cachedMeta.timestamp;
	}

	const stagingManifest = buildDirectoryManifest(stagingModDirectory, fsModule);
	const cachedManifest = buildDirectoryManifest(cachedModDirectory, fsModule);
	return stagingManifest.length === cachedManifest.length
		&& stagingManifest.every((entry, index) => entry === cachedManifest[index]);
}

function appendProcessOutput(current, chunk) {
	const combined = current + chunk.toString();
	return combined.length > PROCESS_OUTPUT_LIMIT ? combined.slice(-PROCESS_OUTPUT_LIMIT) : combined;
}

function runProcess(executable, args, options = {}) {
	const {
		acceptedExitCodes = [0],
		spawnImpl = spawn,
		timeoutMs = 7_200_000,
	} = options;

	return new Promise((resolve, reject) => {
		let output = '';
		let settled = false;
		let child;

		try {
			child = spawnImpl(executable, args, {
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			return reject(error);
		}

		const finish = (error, result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (error) reject(error);
			else resolve(result);
		};

		if (child.stdout) child.stdout.on('data', chunk => { output = appendProcessOutput(output, chunk); });
		if (child.stderr) child.stderr.on('data', chunk => { output = appendProcessOutput(output, chunk); });

		child.on('error', error => finish(error));
		child.on('close', code => {
			if (!acceptedExitCodes.includes(code)) {
				const error = new Error(`${path.basename(executable)} exited with code ${code}.`);
				error.exitCode = code;
				error.output = output;
				return finish(error);
			}
			finish(null, { code, output });
		});

		const timeout = setTimeout(() => {
			child.kill();
			finish(new Error(`${path.basename(executable)} timed out.`));
		}, timeoutMs);
	});
}

async function runSteamCmd(config, workshopId, options = {}) {
	const args = [
		'+@NoPromptForPassword', '1',
		'+force_install_dir', config.stagingDirectory,
		'+login', config.username,
		'+workshop_download_item', String(config.appId), workshopId, 'validate',
		'+quit',
	];

	const result = await runProcess(config.steamCmdPath, args, options);
	const successMessage = `success. downloaded item ${workshopId}`;
	if (!result.output.toLowerCase().includes(successMessage)) {
		const error = new Error(`SteamCMD did not confirm Workshop item ${workshopId}.`);
		error.output = result.output;
		throw error;
	}
	return result;
}

function validateWorkshopChild(parentDirectory, targetDirectory, workshopId) {
	if (!/^\d+$/.test(workshopId)) throw new Error(`Invalid Workshop ID: ${workshopId}`);

	const expected = path.resolve(parentDirectory, workshopId);
	const actual = path.resolve(targetDirectory);
	if (expected !== actual || path.dirname(actual) !== path.resolve(parentDirectory)) {
		throw new Error(`Unsafe Workshop directory: ${targetDirectory}`);
	}
	return actual;
}

function mirrorWorkshopItem(config, workshopId, options = {}) {
	const cacheRoot = path.join(
		config.stagingDirectory,
		'steamapps',
		'workshop',
		'content',
		String(config.appId),
	);
	const sourceDirectory = validateWorkshopChild(cacheRoot, path.join(cacheRoot, workshopId), workshopId);
	const targetDirectory = validateWorkshopChild(
		config.stagingDirectory,
		path.join(config.stagingDirectory, workshopId),
		workshopId,
	);

	return runProcess('robocopy', [
		sourceDirectory,
		targetDirectory,
		'/MIR',
		'/COPY:DAT',
		'/DCOPY:T',
		'/R:2',
		'/W:2',
		'/NFL',
		'/NDL',
		'/NP',
	], {
		...options,
		acceptedExitCodes: [0, 1, 2, 3, 4, 5, 6, 7],
	});
}

function postForm(url, body, httpsModule = https) {
	return new Promise((resolve, reject) => {
		const request = httpsModule.request(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(body),
			},
		}, response => {
			let data = '';
			response.setEncoding('utf8');
			response.on('data', chunk => { data += chunk; });
			response.on('end', () => {
				if (response.statusCode < 200 || response.statusCode >= 300) {
					return reject(new Error(`Steam API returned HTTP ${response.statusCode}.`));
				}
				resolve(data);
			});
		});

		request.setTimeout(10_000, () => request.destroy(new Error('Steam API request timed out.')));
		request.on('error', reject);
		request.write(body);
		request.end();
	});
}

async function fetchWorkshopTitles(workshopIds, options = {}) {
	const { httpsModule = https } = options;
	const titles = new Map();

	for (let offset = 0; offset < workshopIds.length; offset += 100) {
		const batch = workshopIds.slice(offset, offset + 100);
		const params = new URLSearchParams({ itemcount: String(batch.length) });
		batch.forEach((id, index) => params.set(`publishedfileids[${index}]`, id));
		const rawResponse = await postForm(WORKSHOP_DETAILS_URL, params.toString(), httpsModule);
		const details = JSON.parse(rawResponse).response?.publishedfiledetails || [];
		for (const item of details) {
			if (item.result === 1 && item.publishedfileid && item.title) {
				titles.set(String(item.publishedfileid), item.title);
			}
		}
	}

	return titles;
}

function formatDuration(milliseconds) {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts = [];

	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
	parts.push(`${seconds}s`);
	return parts.join(' ');
}

function paginateLines(lines, maxCharacters = 3500) {
	if (lines.length === 0) return [''];

	const pages = [];
	let page = '';
	for (const originalLine of lines) {
		const line = originalLine.length > maxCharacters
			? `${originalLine.slice(0, maxCharacters - 1)}…`
			: originalLine;
		const candidate = page ? `${page}\n${line}` : line;
		if (candidate.length > maxCharacters && page) {
			pages.push(page);
			page = line;
		} else {
			page = candidate;
		}
	}
	if (page) pages.push(page);
	return pages;
}

module.exports = {
	buildDirectoryManifest,
	discoverWorkshopMods,
	fetchWorkshopTitles,
	formatDuration,
	mirrorWorkshopItem,
	paginateLines,
	parseMetaCpp,
	readModMeta,
	runProcess,
	runSteamCmd,
	validateWorkshopChild,
	workshopItemsMatch,
};
