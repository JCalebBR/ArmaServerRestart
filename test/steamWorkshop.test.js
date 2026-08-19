const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const {
	buildDirectoryManifest,
	discoverWorkshopMods,
	formatDuration,
	mirrorWorkshopItem,
	paginateLines,
	parseMetaCpp,
	runProcess,
	runSteamCmd,
	validateWorkshopChild,
	workshopItemsMatch,
} = require('../utils/steamWorkshop');
const { _buildReportEmbeds: buildReportEmbeds } = require('../commands/update');

function temporaryDirectory(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arma-workshop-test-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	return directory;
}

function writeMeta(directory, name, timestamp) {
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(path.join(directory, 'meta.cpp'), `protocol = 1;\nname = "${name}";\ntimestamp = ${timestamp};\n`);
}

function completedSpawn(exitCode, capture, output = 'completed') {
	return (executable, args, options) => {
		if (capture) Object.assign(capture, { executable, args, options });
		const child = new EventEmitter();
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.kill = () => { child.killed = true; };
		process.nextTick(() => {
			child.stdout.end(output);
			child.stderr.end();
			child.emit('close', exitCode);
		});
		return child;
	};
}

test('parseMetaCpp reads Workshop metadata case-insensitively', () => {
	const parsed = parseMetaCpp('publishedId = 450814997;\nNAME = "CBA\\" A3";\ntimestamp = 638000000000000000;');
	assert.deepEqual(parsed, {
		name: 'CBA" A3',
		timestamp: '638000000000000000',
		publishedId: '450814997',
	});
});

test('discoverWorkshopMods includes only immediate numeric directories in numeric order', t => {
	const root = temporaryDirectory(t);
	writeMeta(path.join(root, '20'), 'Twenty', '20');
	writeMeta(path.join(root, '3'), 'Three', '3');
	fs.mkdirSync(path.join(root, 'steamapps'));
	fs.writeFileSync(path.join(root, '123.txt'), 'not a directory');

	const mods = discoverWorkshopMods(root);
	assert.deepEqual(mods.map(mod => mod.id), ['3', '20']);
	assert.equal(mods[0].meta.name, 'Three');
});

test('workshopItemsMatch prefers matching meta timestamps', t => {
	const root = temporaryDirectory(t);
	const staging = path.join(root, 'staging');
	const cache = path.join(root, 'cache');
	writeMeta(staging, 'Old title', '1234');
	writeMeta(cache, 'New title', '1234');
	fs.writeFileSync(path.join(staging, 'different.bin'), 'staging');
	fs.writeFileSync(path.join(cache, 'different.bin'), 'cache');

	assert.equal(workshopItemsMatch(staging, cache), true);
	writeMeta(cache, 'New title', '5678');
	assert.equal(workshopItemsMatch(staging, cache), false);
});

test('workshopItemsMatch falls back to deterministic file manifests', t => {
	const root = temporaryDirectory(t);
	const staging = path.join(root, 'staging');
	const cache = path.join(root, 'cache');
	fs.mkdirSync(staging);
	fs.mkdirSync(cache);
	fs.writeFileSync(path.join(staging, 'same.bin'), 'content');
	fs.copyFileSync(path.join(staging, 'same.bin'), path.join(cache, 'same.bin'));
	const fixedTime = new Date('2026-01-01T00:00:00Z');
	fs.utimesSync(path.join(staging, 'same.bin'), fixedTime, fixedTime);
	fs.utimesSync(path.join(cache, 'same.bin'), fixedTime, fixedTime);

	assert.deepEqual(buildDirectoryManifest(staging), buildDirectoryManifest(cache));
	assert.equal(workshopItemsMatch(staging, cache), true);
	fs.writeFileSync(path.join(cache, 'same.bin'), 'changed content');
	assert.equal(workshopItemsMatch(staging, cache), false);
});

test('runSteamCmd passes cached-login arguments without a password', async () => {
	const capture = {};
	await runSteamCmd({
		steamCmdPath: 'C:\\steamcmd\\steamcmd.exe',
		username: 'workshop-user',
		stagingDirectory: 'C:\\mods',
		appId: 107410,
	}, '450814997', {
		spawnImpl: completedSpawn(0, capture, 'Success. Downloaded item 450814997 to cache.'),
	});

	assert.equal(capture.executable, 'C:\\steamcmd\\steamcmd.exe');
	assert.deepEqual(capture.args, [
		'+@NoPromptForPassword', '1',
		'+force_install_dir', 'C:\\mods',
		'+login', 'workshop-user',
		'+workshop_download_item', '107410', '450814997', 'validate',
		'+quit',
	]);
});

test('runProcess rejects failed commands and retains their output', async () => {
	await assert.rejects(
		runProcess('steamcmd.exe', [], { spawnImpl: completedSpawn(8) }),
		error => error.exitCode === 8 && error.output.includes('completed'),
	);
});

test('runSteamCmd rejects a zero exit code without an item success confirmation', async () => {
	await assert.rejects(
		runSteamCmd({
			steamCmdPath: 'steamcmd.exe',
			username: 'workshop-user',
			stagingDirectory: 'C:\\mods',
			appId: 107410,
		}, '450814997', { spawnImpl: completedSpawn(0) }),
		/SteamCMD did not confirm Workshop item 450814997/,
	);
});

test('mirrorWorkshopItem accepts robocopy success codes and validates its exact paths', async () => {
	const capture = {};
	const config = {
		stagingDirectory: path.resolve('/staging'),
		appId: 107410,
	};
	await mirrorWorkshopItem(config, '450814997', { spawnImpl: completedSpawn(7, capture) });
	assert.equal(capture.executable, 'robocopy');
	assert.equal(capture.args[0], path.resolve('/staging/steamapps/workshop/content/107410/450814997'));
	assert.equal(capture.args[1], path.resolve('/staging/450814997'));
	assert.throws(() => validateWorkshopChild('/staging', '/staging/450814997/child', '450814997'));
	assert.throws(() => validateWorkshopChild('/staging', '/outside/450814997', '450814997'));
});

test('duration formatting and pagination stay concise and bounded', () => {
	assert.equal(formatDuration(3723000), '1h 2m 3s');
	assert.equal(formatDuration(9000), '9s');
	const pages = paginateLines(['12345', '67890', 'abc'], 11);
	assert.deepEqual(pages, ['12345\n67890', 'abc']);
	assert.ok(pages.every(page => page.length <= 11));
});

test('public reports paginate partial successes within Discord limits', () => {
	const updated = Array.from({ length: 80 }, (value, index) => ({
		id: String(450814997 + index),
		title: `Updated Workshop Mod ${index} ${'x'.repeat(80)}`,
	}));
	const failures = [{ id: '999', title: 'Failed Mod', reason: 'SteamCMD failed.' }];
	const embeds = buildReportEmbeds(updated, failures, 81, '2m 4s');

	assert.ok(embeds.length > 1);
	for (const embed of embeds) {
		const data = embed.toJSON();
		assert.ok(data.description.length <= 3500);
		assert.match(data.title, /80\/81 Updated/);
		assert.match(data.footer.text, /Completed in 2m 4s/);
	}
});
