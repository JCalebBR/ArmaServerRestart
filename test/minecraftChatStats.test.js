const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
	MinecraftLogTailer,
	discordContentToMinecraft,
	minecraftToDiscord,
	parseMinecraftChatLine,
	splitText,
	tellrawForDiscord,
} = require('../utils/minecraftChat');
const {
	formatDurationTicks,
	humanizeIdentifier,
	parseMinecraftStats,
} = require('../utils/minecraftStats');
const { secondsUntilNextFourHourRestart } = require('../utils/minecraftServices');
const { RconUnavailableError, sendRcon } = require('../utils/minecraftRcon');

test('chat parser handles standard and Not Secure chat without relay loops', () => {
	assert.deepEqual(
		parseMinecraftChatLine('[12:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: <Steve> hello'),
		{ player: 'Steve', content: 'hello' },
	);
	assert.deepEqual(
		parseMinecraftChatLine('[12:00:00] [Server thread/INFO]: [Not Secure] <Alex> hi'),
		{ player: 'Alex', content: 'hi' },
	);
	assert.equal(parseMinecraftChatLine('[12:00:00] [Server thread/INFO]: <Alex> [Discord] loop'), null);
});

test('chat conversion supports custom emoji, media URLs, clickable tellraw, and safe splitting', () => {
	const attachments = new Map([['1', { url: 'https://example.com/image.gif' }]]);
	const text = discordContentToMinecraft({
		content: 'hello <:wave:123> @everyone',
		cleanContent: 'hello :wave: @everyone',
		attachments,
		stickers: new Map(),
	});
	assert.match(text, /:wave:/);
	assert.match(text, /@ everyone/);
	assert.match(text, /image\.gif/);
	const command = tellrawForDiscord('Nickname', text);
	assert.match(command, /open_url/);
	assert.ok(splitText('a '.repeat(800)).every(chunk => chunk.length <= 700));
	assert.equal(minecraftToDiscord(':wave:', [{ name: 'wave', id: '12', animated: true }]), '<a:wave:12>');
});

test('Minecraft statistics aggregate vanilla and modded namespaces', () => {
	const parsed = parseMinecraftStats({
		stats: {
			'minecraft:custom': {
				'minecraft:play_time': 144000,
				'minecraft:deaths': 2,
				'minecraft:walk_one_cm': 100000,
				'minecraft:damage_dealt': 125,
			},
			'minecraft:killed': { 'minecraft:zombie': 4, 'example:robot': 3 },
			'minecraft:mined': { 'minecraft:stone': 20 },
			'minecraft:crafted': { 'minecraft:stick': 2 },
			'minecraft:used': { 'example:wrench': 8 },
		},
	});
	assert.equal(parsed.summary.playTime, '2h 0m');
	assert.equal(parsed.summary.mobKills, 7);
	assert.equal(parsed.summary.blocksMined, 20);
	assert.equal(parsed.summary.distanceKm, 1);
	assert.equal(parsed.summary.damageDealt, 12.5);
	assert.equal(parsed.categories['Mobs Killed'][0].count, 4);
	assert.equal(humanizeIdentifier('example:laser_wrench'), 'Laser Wrench (example)');
	assert.equal(formatDurationTicks(1200), '1m');
});

test('fixed scheduler finds local four-hour boundaries and warning offsets', () => {
	const warning = secondsUntilNextFourHourRestart(new Date(2026, 0, 1, 3, 50, 0));
	assert.equal(warning.next.getHours(), 4);
	assert.equal(warning.seconds, 600);
	const rollover = secondsUntilNextFourHourRestart(new Date(2026, 0, 1, 23, 59, 50));
	assert.equal(rollover.next.getDate(), 2);
	assert.equal(rollover.next.getHours(), 0);
	assert.equal(rollover.seconds, 10);
});

test('log tail starts at EOF but reads a newly-created or rotated log', async t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marcus-mc-chat-'));
	const logPath = path.join(directory, 'latest.log');
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	fs.writeFileSync(logPath, 'historical\n');
	const lines = [];
	const tailer = new MinecraftLogTailer(logPath, async line => lines.push(line));
	await tailer.poll();
	fs.appendFileSync(logPath, 'new message\n');
	await tailer.poll();
	assert.deepEqual(lines, ['new message']);

	const missingPath = path.join(directory, 'created-later.log');
	const laterLines = [];
	const laterTailer = new MinecraftLogTailer(missingPath, async line => laterLines.push(line));
	await laterTailer.poll();
	fs.writeFileSync(missingPath, 'first live message\n');
	await laterTailer.poll();
	assert.deepEqual(laterLines, ['first live message']);
});

test('RCON reads its secret from the environment and always closes the connection', async t => {
	const previous = process.env.TEST_MINECRAFT_RCON_PASSWORD;
	process.env.TEST_MINECRAFT_RCON_PASSWORD = 'secret';
	t.after(() => {
		if (previous === undefined) delete process.env.TEST_MINECRAFT_RCON_PASSWORD;
		else process.env.TEST_MINECRAFT_RCON_PASSWORD = previous;
	});
	let ended = false;
	let receivedConfig;
	const response = await sendRcon({
		rcon: { host: '127.0.0.1', port: 25575, passwordEnv: 'TEST_MINECRAFT_RCON_PASSWORD' },
	}, 'list', {
		connect: async config => {
			receivedConfig = config;
			return {
				on: () => undefined,
				send: async command => `response:${command}`,
				end: async () => { ended = true; },
			};
		},
	});
	assert.equal(receivedConfig.password, 'secret');
	assert.equal(response, 'response:list');
	assert.equal(ended, true);

	await assert.rejects(sendRcon({ rcon: { passwordEnv: 'TEST_MINECRAFT_RCON_PASSWORD' } }, 'list', {
		connect: async () => { throw new Error('connection refused'); },
	}), error => error instanceof RconUnavailableError);
});
