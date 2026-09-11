const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
	ServerProcessesExistError,
	ServerStartupError,
	ServerTerminationError,
	killProcess,
	launchProcess,
} = require('./server');
const { broadcast, rconOptions, sendRcon } = require('./minecraftRcon');

const PROCESS_QUERY_SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"$processes = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('java.exe','javaw.exe','cmd.exe') }",
	'$processes | Select-Object Name, ProcessId, ParentProcessId, ExecutablePath, CommandLine | ConvertTo-Json -Compress',
].join('; ');

function delay(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function normalizeWindowsPath(value) {
	return String(value || '').replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
}

function describeMinecraftProcess(raw) {
	const pid = Number(raw.ProcessId ?? raw.pid);
	const parentPid = Number(raw.ParentProcessId ?? raw.parentPid) || 0;
	if (!Number.isInteger(pid) || pid <= 0) throw new Error('CIM returned a Minecraft candidate with an invalid PID.');
	return {
		pid,
		parentPid,
		name: String(raw.Name || raw.name || '').toLowerCase(),
		executablePath: raw.ExecutablePath || raw.executablePath || null,
		commandLine: raw.CommandLine ?? raw.commandLine ?? null,
	};
}

function queryMinecraftCandidates(options = {}) {
	const execFileImpl = options.execFileImpl || execFile;
	return new Promise((resolve, reject) => {
		execFileImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROCESS_QUERY_SCRIPT], {
			windowsHide: true,
			maxBuffer: 1024 * 1024,
		}, (error, stdout, stderr) => {
			if (error) {
				const details = String(stderr || '').trim() || error.message;
				return reject(new Error(`Could not inspect Minecraft processes: ${details}`));
			}
			if (!String(stdout || '').trim()) return resolve([]);
			try {
				let rows = JSON.parse(String(stdout).trim().replace(/^\uFEFF/, ''));
				if (!Array.isArray(rows)) rows = [rows];
				resolve(rows.map(describeMinecraftProcess));
			} catch (parseError) {
				reject(new Error(`Could not parse the Minecraft process list: ${parseError.message}`));
			}
		});
	});
}

function matchingMinecraftProcesses(processes, serverConfig) {
	const marker = String(serverConfig.processMarker || 'marcus.serverId=minecraft').toLowerCase();
	const scriptPath = normalizeWindowsPath(serverConfig.startScript);
	const direct = new Set();

	for (const process of processes) {
		const commandLine = String(process.commandLine || '').replace(/\//g, '\\').toLowerCase();
		if (commandLine.includes(`-d${marker}`) || (scriptPath && commandLine.includes(scriptPath))) {
			direct.add(process.pid);
		}
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const process of processes) {
			if ((direct.has(process.parentPid) || [...direct].some(pid => {
				const parent = processes.find(candidate => candidate.pid === pid);
				return parent?.parentPid === process.pid;
			})) && !direct.has(process.pid)) {
				direct.add(process.pid);
				changed = true;
			}
		}
	}

	return processes.filter(process => direct.has(process.pid)).map(process => ({
		...process,
		type: process.name === 'java.exe' || process.name === 'javaw.exe' ? 'MINECRAFT SERVER' : 'LAUNCHER',
	}));
}

async function findMinecraftProcesses(serverConfig, options = {}) {
	const processes = options.processes || await queryMinecraftCandidates(options);
	return matchingMinecraftProcesses(processes, serverConfig);
}

function validateMinecraftConfig(serverConfig, options = {}) {
	for (const field of ['startScript', 'workingDirectory', 'worldDirectory', 'processMarker']) {
		if (!serverConfig[field]) throw new Error(`Minecraft configuration is missing ${field}.`);
	}
	if (!optionsPathExists(serverConfig.startScript)) throw new Error(`Minecraft start script was not found: ${serverConfig.startScript}`);
	if (!optionsPathExists(serverConfig.workingDirectory)) throw new Error(`Minecraft working directory was not found: ${serverConfig.workingDirectory}`);
	if (options.checkRcon !== false) rconOptions(serverConfig);
}

function optionsPathExists(target) {
	return process.platform !== 'win32' || fs.existsSync(target);
}

async function waitFor(condition, options = {}) {
	const delayFn = options.delayFn || delay;
	const intervalMs = options.intervalMs ?? 1000;
	const timeoutMs = options.timeoutMs ?? 30_000;
	const deadline = Date.now() + timeoutMs;
	let lastValue;
	while (Date.now() <= deadline) {
		lastValue = await condition();
		if (lastValue) return lastValue;
		await delayFn(intervalMs);
	}
	return lastValue || null;
}

function minecraftJvmCount(processes) {
	return processes.filter(process => process.type === 'MINECRAFT SERVER').length;
}

async function notifyProgress(callback, progress) {
	try {
		await callback(progress);
	} catch (error) {
		console.warn('[Minecraft Lifecycle] Could not publish progress:', error.message);
	}
}

async function startMinecraftServer(serverConfig, options = {}) {
	validateMinecraftConfig(serverConfig, { checkRcon: options.checkRcon !== false });
	const findProcesses = options.findProcesses || (() => findMinecraftProcesses(serverConfig));
	const launch = options.launch || ((file, args, launchOptions) => launchProcess(file, args, launchOptions));
	const onProgress = options.onProgress || (async () => undefined);
	const existing = await findProcesses();
	if (existing.length > 0) throw new ServerProcessesExistError(existing);

	try {
		await notifyProgress(onProgress, { phase: 'launching_server' });
		const cmdPath = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
		const cmdArguments = `/d /s /c ""${serverConfig.startScript}""`;
		await launch(cmdPath, cmdArguments, { workingDirectory: serverConfig.workingDirectory });

		const processes = await waitFor(async () => {
			const snapshot = await findProcesses();
			return minecraftJvmCount(snapshot) === 1 ? snapshot : null;
		}, {
			delayFn: options.delayFn,
			intervalMs: options.processPollMs ?? 1000,
			timeoutMs: options.processTimeoutMs ?? 60_000,
		});

		if (!processes) throw new ServerStartupError('The marked Minecraft JVM did not start or exited during startup.');
		await notifyProgress(onProgress, { phase: 'waiting_for_minecraft' });

		let exitedDuringStartup = false;
		const readinessCheck = options.readinessCheck || (async () => {
			const snapshot = await findProcesses();
			if (minecraftJvmCount(snapshot) !== 1) {
				exitedDuringStartup = true;
				return true;
			}
			try {
				await sendRcon(serverConfig, 'list');
				return true;
			} catch {
				return false;
			}
		});
		const ready = Boolean(await waitFor(readinessCheck, {
			delayFn: options.delayFn,
			intervalMs: options.readinessPollMs ?? 5000,
			timeoutMs: options.readinessTimeoutMs ?? 600_000,
		}));
		if (exitedDuringStartup) throw new ServerStartupError('The Minecraft JVM exited before RCON became ready.');
		const finalProcesses = await findProcesses();
		if (minecraftJvmCount(finalProcesses) !== 1) {
			throw new ServerStartupError('The Minecraft JVM did not remain in the expected single-process state.', finalProcesses);
		}
		return { processes: finalProcesses, serverCount: 1, hcCount: 0, ready, kind: 'minecraft' };
	} catch (error) {
		try {
			await (options.stop || (() => stopMinecraftServer(serverConfig)))();
		} catch (rollbackError) {
			error.rollbackError = rollbackError;
		}
		throw error;
	}
}

function rootProcesses(processes) {
	const ids = new Set(processes.map(process => process.pid));
	return processes.filter(process => !ids.has(process.parentPid));
}

async function stopMinecraftServer(serverConfig, options = {}) {
	const findProcesses = options.findProcesses || (() => findMinecraftProcesses(serverConfig));
	const terminateProcess = options.terminateProcess || killProcess;
	const delayFn = options.delayFn || delay;
	const initialProcesses = await findProcesses();
	if (initialProcesses.length === 0) return { initialProcesses, terminatedCount: 0, graceful: true };

	let graceful = false;
	const rconSend = options.rconSend || (command => sendRcon(serverConfig, command));
	try {
		await (options.broadcast || (text => broadcast(serverConfig, text)))('[Marcus] Server shutting down. Saving the world...');
	} catch (error) {
		if (options.onGracefulError) await options.onGracefulError(error);
	}
	try {
		await rconSend('save-all flush');
		await rconSend('stop');
		graceful = true;
	} catch (error) {
		if (options.onGracefulError) await options.onGracefulError(error);
	}

	let remaining = await waitFor(async () => {
		const snapshot = await findProcesses();
		return snapshot.length === 0 ? [] : null;
	}, {
		delayFn,
		intervalMs: options.pollIntervalMs ?? 1000,
		timeoutMs: graceful ? (options.gracefulTimeoutMs ?? 120_000) : (options.fallbackGraceMs ?? 10_000),
	});

	const killed = new Set();
	if (!remaining) {
		const deadline = Date.now() + (options.forceTimeoutMs ?? 10_000);
		do {
			remaining = await findProcesses();
			for (const process of rootProcesses(remaining)) {
				killed.add(process.pid);
				try {
					await terminateProcess(process.pid);
				} catch {
					// Discovery below is the authoritative termination check.
				}
			}
			if (remaining.length > 0) await delayFn(options.pollIntervalMs ?? 500);
		} while (remaining.length > 0 && Date.now() <= deadline);
		remaining = await findProcesses();
	}

	if (remaining.length > 0) throw new ServerTerminationError(remaining);
	return {
		initialProcesses,
		terminatedCount: new Set(initialProcesses.map(process => process.pid)).size,
		forceKilledCount: killed.size,
		graceful,
	};
}

async function restartMinecraftServer(serverConfig, options = {}) {
	const stop = options.stop || (() => stopMinecraftServer(serverConfig, options.stopOptions));
	const start = options.start || (() => startMinecraftServer(serverConfig, options.startOptions));
	const stopResult = await stop();
	const startResult = await start();
	return { stopResult, startResult };
}

function minecraftPaths(serverConfig) {
	return {
		latestLog: path.join(serverConfig.workingDirectory, 'logs', 'latest.log'),
		whitelist: path.join(serverConfig.workingDirectory, 'whitelist.json'),
		userCache: path.join(serverConfig.workingDirectory, 'usercache.json'),
		stats: path.join(serverConfig.worldDirectory, 'stats'),
	};
}

module.exports = {
	describeMinecraftProcess,
	findMinecraftProcesses,
	matchingMinecraftProcesses,
	minecraftJvmCount,
	minecraftPaths,
	queryMinecraftCandidates,
	restartMinecraftServer,
	rootProcesses,
	startMinecraftServer,
	stopMinecraftServer,
	validateMinecraftConfig,
	waitFor,
};
