const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
	applyWhitelistOperation,
	closeDatabase,
	getLink,
	getQueue,
	normalizeMinecraftName,
	processWhitelistQueue,
	queueWhitelistOperation,
} = require('../utils/minecraftState');
const { RconUnavailableError } = require('../utils/minecraftRcon');

function fixture(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marcus-mc-state-'));
	const dbPath = path.join(directory, 'state.db');
	const config = { workingDirectory: directory, worldDirectory: path.join(directory, 'world') };
	t.after(() => {
		closeDatabase();
		fs.rmSync(directory, { recursive: true, force: true });
	});
	return { config, dbPath, directory };
}

test('Minecraft names are validated without external profile lookups', () => {
	assert.equal(normalizeMinecraftName('Player_One'), 'Player_One');
	assert.throws(() => normalizeMinecraftName('bad name'), /3–16 characters/);
});

test('whitelist add uses RCON, reconciles UUID, and stores the Discord link', async t => {
	const { config, dbPath, directory } = fixture(t);
	fs.writeFileSync(path.join(directory, 'whitelist.json'), JSON.stringify([{ name: 'PlayerOne', uuid: 'uuid-1' }]));
	const commands = [];
	await applyWhitelistOperation(config, {
		action: 'add',
		minecraftName: 'PlayerOne',
		discordUserId: 'discord-1',
		lastNickname: 'Caleb',
	}, {
		dbPath,
		rconSend: async command => {
			commands.push(command);
			return 'Added PlayerOne to the whitelist';
		},
	});
	assert.deepEqual(commands, ['whitelist add PlayerOne', 'whitelist reload']);
	assert.equal(getLink('uuid-1', { dbPath }).discord_user_id, 'discord-1');
});

test('offline queue is durable, case-insensitive, and last-write-wins', async t => {
	const { config, dbPath, directory } = fixture(t);
	fs.writeFileSync(path.join(directory, 'whitelist.json'), '[]');
	const base = {
		minecraftName: 'PlayerOne',
		requesterUserId: 'requester',
		guildId: 'guild',
	};
	queueWhitelistOperation({ ...base, action: 'add', discordUserId: 'one', lastNickname: 'Old' }, { dbPath });
	queueWhitelistOperation({ ...base, minecraftName: 'playerone', action: 'add', discordUserId: 'two', lastNickname: 'New' }, { dbPath });
	assert.equal(getQueue({ dbPath }).length, 1);
	assert.equal(getQueue({ dbPath })[0].discord_user_id, 'two');

	fs.writeFileSync(path.join(directory, 'whitelist.json'), JSON.stringify([{ name: 'PlayerOne', uuid: 'uuid-2' }]));
	const results = await processWhitelistQueue(config, {
		dbPath,
		rconSend: async () => 'success',
	});
	assert.equal(results[0].status, 'applied');
	assert.equal(getQueue({ dbPath }).length, 0);
	assert.equal(getLink('uuid-2', { dbPath }).discord_user_id, 'two');
});

test('queue retains connection failures and removes definitive rejections after notification', async t => {
	const { config, dbPath, directory } = fixture(t);
	fs.writeFileSync(path.join(directory, 'whitelist.json'), '[]');
	const operation = {
		minecraftName: 'MissingPlayer',
		action: 'add',
		discordUserId: 'one',
		lastNickname: 'Nickname',
		requesterUserId: 'requester',
		guildId: 'guild',
	};
	queueWhitelistOperation(operation, { dbPath });
	let results = await processWhitelistQueue(config, {
		dbPath,
		rconSend: async () => { throw new RconUnavailableError('offline'); },
	});
	assert.equal(results[0].status, 'unavailable');
	assert.equal(getQueue({ dbPath }).length, 1);

	let rejection;
	results = await processWhitelistQueue(config, {
		dbPath,
		rconSend: async () => 'Could not add that player because the player does not exist',
		onRejected: async (row, error) => { rejection = { row, error }; },
	});
	assert.equal(results[0].status, 'rejected');
	assert.equal(getQueue({ dbPath }).length, 0);
	assert.equal(rejection.row.minecraft_name, 'MissingPlayer');
});
