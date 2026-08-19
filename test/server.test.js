const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
	ServerProcessesExistError,
	ServerTerminationError,
	describeArmaProcess,
	killProcess,
	launchProcess,
	parseLaunchArguments,
	processMatchesServer,
	queryArmaProcesses,
	restartConfiguredServer,
	startConfiguredServer,
	stopConfiguredServer,
	tokenizeWindowsCommandLine,
} = require('../utils/server');
const {
	getOperationState,
	resetOperationState,
	tryAcquireMaintenanceOperation,
	tryAcquireServerOperation,
} = require('../utils/operationCoordinator');

const SERVER_CONFIG = {
	port: 2302,
	hcCount: 2,
	serverArgs: '-port=2302 "-config=C:\\Servers\\Black Templars\\server.cfg" "-profiles=C:\\Servers\\Black Templars"',
	hcArgs: '-client -connect=127.0.0.1 -port 2302 "-profiles=C:\\Servers\\Black Templars HC"',
};

function processInfo(pid, type = 'SERVER') {
	return { pid, type };
}

test('Windows command lines preserve quoted arguments and both port syntaxes', () => {
	const tokens = tokenizeWindowsCommandLine('"C:\\Games\\arma3server_x64.exe" -port 2302 "-profiles=C:\\Server Profiles\\Main" "-mod=@One;@Two"');
	assert.deepEqual(tokens, [
		'C:\\Games\\arma3server_x64.exe',
		'-port',
		'2302',
		'-profiles=C:\\Server Profiles\\Main',
		'-mod=@One;@Two',
	]);
	assert.equal(parseLaunchArguments(tokens).options.get('port'), '2302');
	assert.equal(parseLaunchArguments('-port=2402').options.get('port'), '2402');
});

test('process descriptions classify servers and headless clients from arguments', () => {
	const server = describeArmaProcess({
		Name: 'arma3server_x64.exe',
		ProcessId: 10,
		CommandLine: 'arma3server_x64.exe -port=2302 "-config=C:\\Servers\\Black Templars\\server.cfg"',
	});
	const client = describeArmaProcess({
		Name: 'arma3server_x64.exe',
		ProcessId: 11,
		CommandLine: 'arma3server_x64.exe -client -port 2302',
	});

	assert.equal(server.type, 'SERVER');
	assert.equal(server.port, 2302);
	assert.equal(client.type, 'HEADLESS CLIENT');
	assert.equal(client.port, 2302);
});

test('matching uses the port first and config/profile arguments as fallbacks', () => {
	const duplicate = describeArmaProcess({
		ProcessId: 20,
		CommandLine: 'arma3server_x64.exe -port=2302 "-config=C:\\Other\\stale.cfg"',
	});
	const missingPort = describeArmaProcess({
		ProcessId: 21,
		CommandLine: 'arma3server_x64.exe "-config=C:\\Servers\\Black Templars\\server.cfg"',
	});
	const unrelated = describeArmaProcess({
		ProcessId: 22,
		CommandLine: 'arma3server_x64.exe -port=2502 "-config=C:\\Other\\server.cfg"',
	});

	assert.equal(processMatchesServer(duplicate, SERVER_CONFIG), true);
	assert.equal(processMatchesServer(missingPort, SERVER_CONFIG), true);
	assert.equal(processMatchesServer(unrelated, SERVER_CONFIG), false);
});

test('CIM failures and unreadable command lines reject instead of returning offline', async () => {
	await assert.rejects(
		queryArmaProcesses({
			execFileImpl: (file, args, options, callback) => callback(new Error('CIM unavailable'), '', 'access denied'),
		}),
		/Could not inspect Arma processes: access denied/,
	);

	await assert.rejects(
		queryArmaProcesses({
			execFileImpl: (file, args, options, callback) => callback(null, JSON.stringify({ ProcessId: 50, CommandLine: null }), ''),
		}),
		/Cannot inspect command-line arguments for Arma process PID 50/,
	);
});

test('CIM discovery returns every duplicate process with parsed arguments', async () => {
	let invocation;
	const rawProcesses = [
		{ Name: 'arma3server_x64.exe', ProcessId: 60, CommandLine: 'arma3server_x64.exe -port=2302' },
		{ Name: 'arma3server_x64.exe', ProcessId: 61, CommandLine: 'arma3server_x64.exe -client -port 2302' },
	];
	const processes = await queryArmaProcesses({
		execFileImpl: (file, args, options, callback) => {
			invocation = { file, args, options };
			callback(null, JSON.stringify(rawProcesses), '');
		},
	});

	assert.equal(invocation.file, 'powershell.exe');
	assert.ok(invocation.args.includes('-NoProfile'));
	assert.match(invocation.args.at(-1), /Get-CimInstance.+\| Select-Object.+\| ConvertTo-Json/);
	assert.deepEqual(processes.map(process => process.pid), [60, 61]);
	assert.deepEqual(processes.map(process => process.type), ['SERVER', 'HEADLESS CLIENT']);
});

test('direct launches use tokenized arguments and return the spawned PID', async () => {
	const capture = {};
	const child = new EventEmitter();
	child.pid = 1234;
	child.unref = () => { capture.unref = true; };
	const resultPromise = launchProcess('arma3server_x64.exe', '-port=2302 "-mod=@One;@Two"', {
		spawnImpl: (file, args, options) => {
			Object.assign(capture, { file, args, options });
			process.nextTick(() => child.emit('spawn'));
			return child;
		},
	});

	assert.deepEqual(await resultPromise, { pid: 1234 });
	assert.deepEqual(capture.args, ['-port=2302', '-mod=@One;@Two']);
	assert.equal(capture.options.detached, true);
	assert.equal(capture.unref, true);
});

test('termination uses taskkill against the complete process tree', async () => {
	let invocation;
	await killProcess(1234, {
		execFileImpl: (file, args, options, callback) => {
			invocation = { file, args, options };
			callback(null, 'SUCCESS', '');
		},
	});
	assert.equal(invocation.file, 'taskkill.exe');
	assert.deepEqual(invocation.args, ['/PID', '1234', '/T', '/F']);
});

test('start refuses every pre-existing matching process without launching', async () => {
	let launchCount = 0;
	await assert.rejects(
		startConfiguredServer({ exePath: 'arma.exe' }, SERVER_CONFIG, {
			findProcesses: async () => [processInfo(1), processInfo(2, 'HEADLESS CLIENT')],
			launch: async () => { launchCount++; },
		}),
		error => error instanceof ServerProcessesExistError && error.processes.length === 2,
	);
	assert.equal(launchCount, 0);
});

test('start verifies one server and the configured headless-client count', async () => {
	const snapshots = [
		[],
		[processInfo(1)],
		[processInfo(1), processInfo(2, 'HEADLESS CLIENT'), processInfo(3, 'HEADLESS CLIENT')],
	];
	const launches = [];
	const result = await startConfiguredServer({ exePath: 'arma.exe' }, SERVER_CONFIG, {
		findProcesses: async () => snapshots.shift(),
		launch: async (executable, args) => { launches.push({ executable, args }); },
		delayFn: async () => undefined,
	});

	assert.equal(result.serverCount, 1);
	assert.equal(result.hcCount, 2);
	assert.equal(launches.length, 3);
	assert.equal(launches[0].args, SERVER_CONFIG.serverArgs);
	assert.equal(launches[1].args, SERVER_CONFIG.hcArgs);
});

test('partial startup triggers complete rollback', async () => {
	const snapshots = [
		[],
		[processInfo(1)],
		[processInfo(1), processInfo(2, 'HEADLESS CLIENT')],
	];
	let rollbackCount = 0;
	await assert.rejects(
		startConfiguredServer({ exePath: 'arma.exe' }, SERVER_CONFIG, {
			findProcesses: async () => snapshots.shift(),
			launch: async () => undefined,
			stop: async () => { rollbackCount++; },
			delayFn: async () => undefined,
		}),
		/Expected 1 server and 2 headless client/,
	);
	assert.equal(rollbackCount, 1);
});

test('an early server exit triggers rollback before headless clients launch', async () => {
	const snapshots = [[], []];
	let rollbackCount = 0;
	let launchCount = 0;
	await assert.rejects(
		startConfiguredServer({ exePath: 'arma.exe' }, SERVER_CONFIG, {
			findProcesses: async () => snapshots.shift(),
			launch: async () => { launchCount++; },
			stop: async () => { rollbackCount++; },
			delayFn: async () => undefined,
		}),
		/The server process did not reach the expected initial state/,
	);
	assert.equal(launchCount, 1);
	assert.equal(rollbackCount, 1);
});

test('stop removes duplicate servers and clients and verifies an empty state', async () => {
	const duplicates = [processInfo(1), processInfo(2), processInfo(3, 'HEADLESS CLIENT')];
	const snapshots = [duplicates, []];
	const killed = [];
	const result = await stopConfiguredServer(SERVER_CONFIG, {
		findProcesses: async () => snapshots.shift(),
		terminateProcess: async pid => { killed.push(pid); },
		delayFn: async () => undefined,
	});

	assert.deepEqual(killed.sort(), [1, 2, 3]);
	assert.equal(result.terminatedCount, 3);
	assert.deepEqual(result.initialCounts, { serverCount: 2, hcCount: 1 });
});

test('stop reports processes that remain after the verification timeout', async () => {
	const remaining = [processInfo(9)];
	await assert.rejects(
		stopConfiguredServer(SERVER_CONFIG, {
			findProcesses: async () => remaining,
			terminateProcess: async () => undefined,
			delayFn: async () => undefined,
			timeoutMs: 1,
			pollIntervalMs: 1,
		}),
		error => error instanceof ServerTerminationError && error.processes[0].pid === 9,
	);
});

test('restart starts the configured state when offline and after duplicate cleanup', async () => {
	for (const initialCount of [0, 3]) {
		let stopCount = 0;
		let startCount = 0;
		const result = await restartConfiguredServer({ exePath: 'arma.exe' }, SERVER_CONFIG, {
			stop: async () => {
				stopCount++;
				return { terminatedCount: initialCount };
			},
			start: async () => {
				startCount++;
				return { serverCount: 1, hcCount: 2 };
			},
		});

		assert.equal(stopCount, 1);
		assert.equal(startCount, 1);
		assert.equal(result.stopResult.terminatedCount, initialCount);
		assert.deepEqual(result.startResult, { serverCount: 1, hcCount: 2 });
	}
});

test('server and maintenance leases are mutually exclusive and release safely', () => {
	resetOperationState();
	const firstServer = tryAcquireServerOperation(2302);
	const otherServer = tryAcquireServerOperation(2402);
	assert.equal(firstServer.acquired, true);
	assert.equal(otherServer.acquired, true);
	assert.deepEqual(tryAcquireServerOperation(2302), { acquired: false, reason: 'server' });
	assert.deepEqual(tryAcquireMaintenanceOperation(), { acquired: false, reason: 'server' });

	firstServer.release();
	otherServer.release();
	const maintenance = tryAcquireMaintenanceOperation();
	assert.equal(maintenance.acquired, true);
	assert.deepEqual(tryAcquireServerOperation(2302), { acquired: false, reason: 'maintenance' });
	maintenance.release();
	maintenance.release();
	assert.deepEqual(getOperationState(), { maintenanceActive: false, serverKeys: [] });
});
