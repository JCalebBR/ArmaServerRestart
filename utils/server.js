const { execFile, spawn } = require('child_process');

const PROCESS_QUERY_SCRIPT = "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -Filter \"name like 'arma3server%'\" | Select-Object Name, ProcessId, ExecutablePath, CommandLine | ConvertTo-Json -Compress";

class ServerProcessesExistError extends Error {
	constructor(processes) {
		super('Matching Arma processes are already running.');
		this.name = 'ServerProcessesExistError';
		this.processes = processes;
	}
}

class ServerStartupError extends Error {
	constructor(message, processes = []) {
		super(message);
		this.name = 'ServerStartupError';
		this.processes = processes;
	}
}

class ServerTerminationError extends Error {
	constructor(processes, errors = []) {
		super(`Could not terminate ${processes.length} matching Arma process(es).`);
		this.name = 'ServerTerminationError';
		this.processes = processes;
		this.errors = errors;
	}
}

function delay(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function notifyProgress(callback, progress) {
	try {
		await callback(progress);
	} catch (error) {
		console.warn('[Server Lifecycle] Could not publish progress:', error.message);
	}
}

function tokenizeWindowsCommandLine(commandLine) {
	if (!commandLine || typeof commandLine !== 'string') return [];

	const tokens = [];
	let current = '';
	let inQuotes = false;

	for (let index = 0; index < commandLine.length; index++) {
		const character = commandLine[index];
		if (character === '"') {
			inQuotes = !inQuotes;
			continue;
		}

		if (/\s/.test(character) && !inQuotes) {
			if (current) {
				tokens.push(current);
				current = '';
			}
			continue;
		}

		current += character;
	}

	if (current) tokens.push(current);
	return tokens;
}

function parseLaunchArguments(commandLine) {
	const tokens = Array.isArray(commandLine) ? commandLine : tokenizeWindowsCommandLine(commandLine);
	const options = new Map();
	const flags = new Set();

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token.startsWith('-')) continue;

		const equalsIndex = token.indexOf('=');
		if (equalsIndex > 1) {
			const name = token.slice(1, equalsIndex).toLowerCase();
			options.set(name, token.slice(equalsIndex + 1));
			continue;
		}

		const name = token.slice(1).toLowerCase();
		const nextToken = tokens[index + 1];
		if (nextToken && !nextToken.startsWith('-')) {
			options.set(name, nextToken);
			index++;
		} else {
			flags.add(name);
		}
	}

	return { flags, options, tokens };
}

function normalizePathArgument(value) {
	if (!value) return null;
	return value.trim().replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
}

function describeArmaProcess(rawProcess) {
	const pid = Number(rawProcess.ProcessId ?? rawProcess.pid);
	const commandLine = rawProcess.CommandLine ?? rawProcess.commandLine;
	if (!Number.isInteger(pid) || pid <= 0) throw new Error('CIM returned an Arma process with an invalid PID.');
	if (!commandLine || typeof commandLine !== 'string') {
		throw new Error(`Cannot inspect command-line arguments for Arma process PID ${pid}.`);
	}

	const parsed = parseLaunchArguments(commandLine);
	const rawPort = parsed.options.get('port');
	const parsedPort = rawPort && /^\d+$/.test(rawPort) ? Number(rawPort) : null;

	return {
		pid,
		name: rawProcess.Name || rawProcess.name || 'arma3server',
		executablePath: rawProcess.ExecutablePath || rawProcess.executablePath || null,
		commandLine,
		type: parsed.flags.has('client') ? 'HEADLESS CLIENT' : 'SERVER',
		port: parsedPort,
		configPath: normalizePathArgument(parsed.options.get('config')),
		profilesPath: normalizePathArgument(parsed.options.get('profiles')),
		args: parsed,
	};
}

function queryArmaProcesses(options = {}) {
	const { execFileImpl = execFile } = options;

	return new Promise((resolve, reject) => {
		execFileImpl('powershell.exe', [
			'-NoProfile',
			'-NonInteractive',
			'-Command',
			PROCESS_QUERY_SCRIPT,
		], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				const details = String(stderr || '').trim() || error.message;
				return reject(new Error(`Could not inspect Arma processes: ${details}`));
			}
			if (!String(stdout || '').trim()) return resolve([]);

			try {
				let processes = JSON.parse(String(stdout).trim().replace(/^\uFEFF/, ''));
				if (!Array.isArray(processes)) processes = [processes];
				resolve(processes.map(describeArmaProcess));
			} catch (parseError) {
				reject(new Error(`Could not parse the Arma process list: ${parseError.message}`));
			}
		});
	});
}

function configuredIdentity(serverConfig) {
	const serverArgs = parseLaunchArguments(serverConfig.serverArgs || '');
	const hcArgs = parseLaunchArguments(serverConfig.hcArgs || '');
	return {
		port: Number(serverConfig.port),
		configPaths: new Set([
			normalizePathArgument(serverArgs.options.get('config')),
		].filter(Boolean)),
		profilesPaths: new Set([
			normalizePathArgument(serverArgs.options.get('profiles')),
			normalizePathArgument(hcArgs.options.get('profiles')),
		].filter(Boolean)),
	};
}

function processMatchesServer(process, serverConfig) {
	const identity = configuredIdentity(serverConfig);
	if (process.port !== null && process.port === identity.port) return true;
	if (process.configPath && identity.configPaths.has(process.configPath)) return true;
	return Boolean(process.profilesPath && identity.profilesPaths.has(process.profilesPath));
}

async function findAllArmaProcesses(options = {}) {
	return queryArmaProcesses(options);
}

async function findConfiguredServerProcesses(serverConfig, options = {}) {
	const processes = await queryArmaProcesses(options);
	return processes.filter(process => processMatchesServer(process, serverConfig));
}

function countProcessTypes(processes) {
	return {
		serverCount: processes.filter(process => process.type === 'SERVER').length,
		hcCount: processes.filter(process => process.type === 'HEADLESS CLIENT').length,
	};
}

function launchProcess(executablePath, args, options = {}) {
	const { spawnImpl = spawn } = options;
	const argumentList = Array.isArray(args) ? args : tokenizeWindowsCommandLine(args);

	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawnImpl(executablePath, argumentList, {
				detached: true,
				stdio: 'ignore',
				windowsHide: true,
			});
		} catch (error) {
			return reject(error);
		}

		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve({ pid: child.pid });
		});
	});
}

function killProcess(pid, options = {}) {
	const { execFileImpl = execFile } = options;
	return new Promise((resolve, reject) => {
		execFileImpl('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error, stdout, stderr) => {
			if (error) {
				const details = String(stderr || stdout || '').trim() || error.message;
				return reject(new Error(`Could not terminate PID ${pid}: ${details}`));
			}
			resolve(true);
		});
	});
}

async function stopConfiguredServer(serverConfig, options = {}) {
	const findProcesses = options.findProcesses || (() => findConfiguredServerProcesses(serverConfig));
	const terminateProcess = options.terminateProcess || killProcess;
	const delayFn = options.delayFn || delay;
	const pollIntervalMs = options.pollIntervalMs ?? 500;
	const timeoutMs = options.timeoutMs ?? 10_000;
	const maxAttempts = Math.max(1, Math.ceil(timeoutMs / Math.max(1, pollIntervalMs)));
	const initialProcesses = await findProcesses();
	let remainingProcesses = initialProcesses;
	const attemptedPids = new Set();
	const terminationErrors = [];

	for (let attempt = 0; remainingProcesses.length > 0 && attempt < maxAttempts; attempt++) {
		const results = await Promise.allSettled(remainingProcesses.map(process => {
			attemptedPids.add(process.pid);
			return terminateProcess(process.pid);
		}));
		for (const result of results) {
			if (result.status === 'rejected') terminationErrors.push(result.reason);
		}

		await delayFn(pollIntervalMs);
		remainingProcesses = await findProcesses();
	}

	if (remainingProcesses.length > 0) {
		throw new ServerTerminationError(remainingProcesses, terminationErrors);
	}

	return {
		initialProcesses,
		initialCounts: countProcessTypes(initialProcesses),
		terminatedCount: attemptedPids.size,
	};
}

async function startConfiguredServer(fullConfig, serverConfig, options = {}) {
	const findProcesses = options.findProcesses || (() => findConfiguredServerProcesses(serverConfig));
	const launch = options.launch || launchProcess;
	const stop = options.stop || (() => stopConfiguredServer(serverConfig));
	const delayFn = options.delayFn || delay;
	const onProgress = options.onProgress || (async () => undefined);
	const verificationDelayMs = options.verificationDelayMs ?? 2_000;
	const hcStartDelayMs = options.hcStartDelayMs ?? 10_000;
	const betweenHcDelayMs = options.betweenHcDelayMs ?? 2_000;
	const expectedHcCount = Number(serverConfig.hcCount) || 0;
	const existingProcesses = await findProcesses();

	if (existingProcesses.length > 0) throw new ServerProcessesExistError(existingProcesses);

	try {
		await notifyProgress(onProgress, { phase: 'launching_server' });
		await launch(fullConfig.exePath, serverConfig.serverArgs);
		await delayFn(verificationDelayMs);

		let processes = await findProcesses();
		let counts = countProcessTypes(processes);
		if (counts.serverCount !== 1 || counts.hcCount !== 0) {
			throw new ServerStartupError('The server process did not reach the expected initial state.', processes);
		}

		if (expectedHcCount > 0) {
			await notifyProgress(onProgress, { phase: 'waiting_for_hcs', hcCount: expectedHcCount });
			await delayFn(hcStartDelayMs);
			for (let index = 0; index < expectedHcCount; index++) {
				await notifyProgress(onProgress, { phase: 'launching_hc', index: index + 1, hcCount: expectedHcCount });
				await launch(fullConfig.exePath, serverConfig.hcArgs);
				await delayFn(betweenHcDelayMs);
			}
		}

		processes = await findProcesses();
		counts = countProcessTypes(processes);
		if (counts.serverCount !== 1 || counts.hcCount !== expectedHcCount) {
			throw new ServerStartupError(
				`Expected 1 server and ${expectedHcCount} headless client(s), but found ${counts.serverCount} and ${counts.hcCount}.`,
				processes,
			);
		}

		return { processes, ...counts };
	} catch (error) {
		await notifyProgress(onProgress, { phase: 'rolling_back' });
		try {
			await stop();
		} catch (rollbackError) {
			error.rollbackError = rollbackError;
		}
		throw error;
	}
}

async function restartConfiguredServer(fullConfig, serverConfig, options = {}) {
	const stop = options.stop || (() => stopConfiguredServer(serverConfig));
	const start = options.start || (() => startConfiguredServer(fullConfig, serverConfig, options.startOptions));
	const stopResult = await stop();
	const startResult = await start();
	return { startResult, stopResult };
}

module.exports = {
	ServerProcessesExistError,
	ServerStartupError,
	ServerTerminationError,
	configuredIdentity,
	countProcessTypes,
	describeArmaProcess,
	findAllArmaProcesses,
	findConfiguredServerProcesses,
	killProcess,
	launchProcess,
	normalizePathArgument,
	parseLaunchArguments,
	processMatchesServer,
	queryArmaProcesses,
	restartConfiguredServer,
	startConfiguredServer,
	stopConfiguredServer,
	tokenizeWindowsCommandLine,
};
