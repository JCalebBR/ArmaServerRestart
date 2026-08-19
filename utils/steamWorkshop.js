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
		onOutput,
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

		const captureOutput = (chunk, source) => {
			output = appendProcessOutput(output, chunk);
			if (onOutput) onOutput(chunk, source);
		};

		if (child.stdout) child.stdout.on('data', chunk => captureOutput(chunk, 'stdout'));
		if (child.stderr) child.stderr.on('data', chunk => captureOutput(chunk, 'stderr'));

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

function summarizeSteamCmdFailure(output, exitCode) {
	const normalized = typeof output === 'string' ? output : '';
	if (/rate limit exceeded/i.test(normalized)) return 'Steam login was rate limited.';
	if (/no cached credentials/i.test(normalized)) return 'SteamCMD has no cached credentials for the configured account.';
	if (/invalid password/i.test(normalized)) return 'Steam rejected the cached password or login ticket.';
	if (/account logon denied|steam guard/i.test(normalized)) return 'Steam Guard authorization is required.';
	if (/no subscription/i.test(normalized)) return 'The Steam account does not own or cannot access this Workshop item.';

	const loginError = normalized.match(/Logging in[^\r\n]*ERROR\s*\(([^)\r\n]+)\)/i);
	if (loginError) return `Steam login failed: ${loginError[1].trim()}.`;
	if (Number.isInteger(exitCode)) return `SteamCMD exited with code ${exitCode} without confirming the download.`;
	return 'SteamCMD did not confirm the download.';
}

function createWorkshopResultTracker(workshopIds, onItemComplete) {
	const expectedIds = new Set(workshopIds);
	const results = new Map();
	const buffers = { stdout: '', stderr: '' };

	const record = (result, notify = true) => {
		if (!expectedIds.has(result.id) || results.has(result.id)) return;
		results.set(result.id, result);
		if (notify && onItemComplete) onItemComplete(result);
	};

	const parseLine = line => {
		const success = line.match(/Success\.\s+Downloaded item\s+(\d+)\b/i);
		if (success) {
			record({ id: success[1], success: true });
			return;
		}

		const failure = line.match(/ERROR!\s+Download item\s+(\d+)\s+failed\s+\(([^)\r\n]+)\)/i);
		if (failure) {
			record({
				id: failure[1],
				success: false,
				reason: `SteamCMD download failed: ${failure[2].trim()}.`,
			});
		}
	};

	const consume = (chunk, source = 'stdout') => {
		const bufferName = source === 'stderr' ? 'stderr' : 'stdout';
		buffers[bufferName] += chunk.toString();
		const lines = buffers[bufferName].split(/\r?\n/);
		buffers[bufferName] = lines.pop();
		for (const line of lines) parseLine(line);
	};

	const finish = fallbackReason => {
		parseLine(buffers.stdout);
		parseLine(buffers.stderr);
		for (const id of workshopIds) {
			record({ id, success: false, reason: fallbackReason }, false);
		}
		return workshopIds.map(id => results.get(id));
	};

	return { consume, finish };
}

async function runSteamCmdBatch(config, workshopIds, options = {}) {
	if (!Array.isArray(workshopIds) || workshopIds.length === 0) {
		return { code: 0, output: '', results: [] };
	}

	const normalizedIds = workshopIds.map(String);
	if (new Set(normalizedIds).size !== normalizedIds.length || normalizedIds.some(id => !/^\d+$/.test(id))) {
		throw new Error('Workshop IDs must be unique numeric strings.');
	}

	const { onItemComplete, ...processOptions } = options;
	const args = [
		'+@ShutdownOnFailedCommand', '0',
		'+@NoPromptForPassword', '1',
		'+force_install_dir', config.stagingDirectory,
		'+login', config.username,
	];
	for (const workshopId of normalizedIds) {
		args.push('+workshop_download_item', String(config.appId), workshopId, 'validate');
	}
	args.push('+quit');

	const tracker = createWorkshopResultTracker(normalizedIds, onItemComplete);
	const callerOnOutput = processOptions.onOutput;
	let processResult;
	let processError;

	try {
		processResult = await runProcess(config.steamCmdPath, args, {
			...processOptions,
			onOutput: (chunk, source) => {
				tracker.consume(chunk, source);
				if (callerOnOutput) callerOnOutput(chunk, source);
			},
		});
	} catch (error) {
		if (!Number.isInteger(error.exitCode)) throw error;
		processError = error;
	}

	const code = processResult ? processResult.code : processError.exitCode;
	const output = processResult ? processResult.output : processError.output;
	const results = tracker.finish(summarizeSteamCmdFailure(output, code));
	return { code, output, results };
}

async function runSteamCmd(config, workshopId, options = {}) {
	const batch = await runSteamCmdBatch(config, [workshopId], options);
	const result = batch.results[0];
	if (!result.success) {
		const error = new Error(result.reason);
		error.exitCode = batch.code;
		error.output = batch.output;
		throw error;
	}

	return { code: batch.code, output: batch.output };
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
	runSteamCmdBatch,
	summarizeSteamCmdFailure,
	validateWorkshopChild,
	workshopItemsMatch,
};
