const assert = require('node:assert/strict');
const test = require('node:test');
const {
	describeMinecraftProcess,
	matchingMinecraftProcesses,
	minecraftJvmCount,
	minecraftLogContainsReadyLine,
	queryMinecraftCandidates,
	startMinecraftServer,
	stopMinecraftServer,
} = require('../utils/minecraft');
const { ServerProcessesExistError } = require('../utils/server');

const CONFIG = {
	kind: 'minecraft',
	port: 25565,
	workingDirectory: 'C:\\Servers\\ATM 10',
	startScript: 'C:\\Servers\\ATM 10\\startserver.bat',
	worldDirectory: 'C:\\Servers\\ATM 10\\world',
	processMarker: 'marcus.serverId=minecraft',
};

function processInfo(pid, name, commandLine, parentPid = 0) {
	const process = describeMinecraftProcess({ Name: name, ProcessId: pid, ParentProcessId: parentPid, CommandLine: commandLine });
	process.type = name.toLowerCase().startsWith('java') ? 'MINECRAFT SERVER' : 'LAUNCHER';
	return process;
}

test('Minecraft matching finds marked JVMs, launchers, descendants, and duplicate instances', () => {
	const rows = [
		processInfo(10, 'cmd.exe', 'cmd.exe /c "C:\\Servers\\ATM 10\\startserver.bat"'),
		processInfo(11, 'java.exe', 'java.exe -Dmarcus.serverId=minecraft @user_jvm_args.txt', 10),
		processInfo(12, 'java.exe', 'java.exe -jar unrelated.jar'),
		processInfo(20, 'cmd.exe', 'cmd.exe /c "C:\\Servers\\ATM 10\\startserver.bat"'),
		processInfo(21, 'java.exe', null, 20),
	];
	const matches = matchingMinecraftProcesses(rows, CONFIG);
	assert.deepEqual(matches.map(item => item.pid), [10, 11, 20, 21]);
	assert.equal(minecraftJvmCount(matches), 2);
});

test('Minecraft CIM failures and malformed output remain real errors', async () => {
	await assert.rejects(queryMinecraftCandidates({
		execFileImpl: (file, args, options, callback) => callback(new Error('failed'), '', 'access denied'),
	}), /Could not inspect Minecraft processes: access denied/);
	await assert.rejects(queryMinecraftCandidates({
		execFileImpl: (file, args, options, callback) => callback(null, '{bad', ''),
	}), /Could not parse the Minecraft process list/);
});

test('Minecraft log readiness recognizes the dedicated-server Done line', () => {
	assert.equal(minecraftLogContainsReadyLine('[Server thread/INFO]: Done (2.221s)! For help, type "help"'), true);
	assert.equal(minecraftLogContainsReadyLine('[Server thread/INFO]: Starting Minecraft server on *:25565'), false);
});

test('Minecraft start refuses duplicates and launches the batch file in an independent cmd process', async () => {
	await assert.rejects(startMinecraftServer(CONFIG, {
		checkRcon: false,
		findProcesses: async () => [processInfo(1, 'java.exe', 'java -Dmarcus.serverId=minecraft')],
	}), error => error instanceof ServerProcessesExistError);

	const snapshots = [
		[],
		[processInfo(10, 'cmd.exe', 'cmd /c "C:\\Servers\\ATM 10\\startserver.bat"')],
		[
			processInfo(10, 'cmd.exe', 'cmd /c "C:\\Servers\\ATM 10\\startserver.bat"'),
			processInfo(11, 'java.exe', 'java -Dmarcus.serverId=minecraft', 10),
		],
		[processInfo(11, 'java.exe', 'java -Dmarcus.serverId=minecraft')],
	];
	let launch;
	let readinessChecks = 0;
	const result = await startMinecraftServer(CONFIG, {
		checkRcon: false,
		findProcesses: async () => snapshots.shift(),
		launch: async (file, args, options) => { launch = { file, args, options }; },
		readinessCheck: async () => ++readinessChecks > 1,
		delayFn: async () => undefined,
	});
	assert.match(launch.file, /cmd\.exe$/i);
	assert.match(launch.args, /startserver\.bat/);
	assert.equal(launch.options.workingDirectory, CONFIG.workingDirectory);
	assert.equal(result.ready, true);
});

test('Minecraft start reports unavailable RCON after the game log reaches Done without rolling back the live JVM', async () => {
	const running = [processInfo(11, 'java.exe', 'java -Dmarcus.serverId=minecraft')];
	const snapshots = [[], running, running, running];
	let rollbackCount = 0;
	const result = await startMinecraftServer(CONFIG, {
		checkRcon: false,
		findProcesses: async () => snapshots.shift() || running,
		launch: async () => undefined,
		rconSend: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:25575'); },
		logReadyCheck: async () => true,
		rconPostReadyGraceMs: 0,
		delayFn: async () => undefined,
		stop: async () => { rollbackCount++; },
	});
	assert.equal(result.ready, false);
	assert.match(result.readinessError, /enable-rcon=true/);
	assert.equal(rollbackCount, 0);
});

test('Minecraft stop saves through RCON and verifies graceful process exit', async () => {
	const running = [
		processInfo(10, 'cmd.exe', 'cmd /c startserver.bat'),
		processInfo(11, 'java.exe', 'java -Dmarcus.serverId=minecraft', 10),
	];
	const snapshots = [running, []];
	const commands = [];
	const result = await stopMinecraftServer(CONFIG, {
		findProcesses: async () => snapshots.shift() || [],
		broadcast: async text => commands.push(text),
		rconSend: async command => commands.push(command),
		delayFn: async () => undefined,
	});
	assert.deepEqual(commands, [
		'[Marcus] Server shutting down. Saving the world...',
		'save-all flush',
		'stop',
	]);
	assert.equal(result.graceful, true);
	assert.equal(result.terminatedCount, 2);
});

test('Minecraft early exit rolls back and forced stop kills the launcher process tree', async () => {
	const running = [
		processInfo(10, 'cmd.exe', 'cmd /c startserver.bat'),
		processInfo(11, 'java.exe', 'java -Dmarcus.serverId=minecraft', 10),
	];
	let rollbackCount = 0;
	const startupSnapshots = [[], running, []];
	await assert.rejects(startMinecraftServer(CONFIG, {
		checkRcon: false,
		findProcesses: async () => startupSnapshots.shift(),
		launch: async () => undefined,
		stop: async () => { rollbackCount++; },
		delayFn: async () => undefined,
	}), /exited before RCON/);
	assert.equal(rollbackCount, 1);

	const stopSnapshots = [running, running, running, [], []];
	const killed = [];
	const result = await stopMinecraftServer(CONFIG, {
		findProcesses: async () => stopSnapshots.shift() || [],
		broadcast: async () => { throw new Error('offline'); },
		rconSend: async () => { throw new Error('offline'); },
		terminateProcess: async pid => killed.push(pid),
		delayFn: async () => new Promise(resolve => setTimeout(resolve, 1)),
		fallbackGraceMs: 0,
		forceTimeoutMs: 1000,
	});
	assert.deepEqual(killed, [10]);
	assert.equal(result.graceful, false);
	assert.equal(result.forceKilledCount, 1);
});
