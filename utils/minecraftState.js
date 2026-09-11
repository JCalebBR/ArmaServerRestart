const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { minecraftPaths } = require('./minecraft');
const { RconUnavailableError, sendRcon } = require('./minecraftRcon');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'minecraft_state.db');
let database;
let databasePath;

class WhitelistRejectedError extends Error {
	constructor(message) {
		super(message);
		this.name = 'WhitelistRejectedError';
	}
}

function normalizeMinecraftName(name) {
	const normalized = String(name || '').trim();
	if (!/^[A-Za-z0-9_]{3,16}$/.test(normalized)) {
		throw new Error('Minecraft usernames must be 3–16 characters and contain only letters, numbers, or underscores.');
	}
	return normalized;
}

function getDatabase(options = {}) {
	const requestedPath = options.dbPath || process.env.MINECRAFT_STATE_DB || DEFAULT_DB_PATH;
	if (database && databasePath === requestedPath) return database;
	if (database) database.close();
	database = new Database(requestedPath);
	databasePath = requestedPath;
	database.exec(`
		CREATE TABLE IF NOT EXISTS minecraft_links (
			minecraft_name TEXT PRIMARY KEY COLLATE NOCASE,
			minecraft_uuid TEXT,
			discord_user_id TEXT NOT NULL,
			last_nickname TEXT,
			updated_at TEXT NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS minecraft_links_uuid
			ON minecraft_links(minecraft_uuid) WHERE minecraft_uuid IS NOT NULL;
		CREATE TABLE IF NOT EXISTS minecraft_whitelist_queue (
			minecraft_name TEXT PRIMARY KEY COLLATE NOCASE,
			action TEXT NOT NULL CHECK(action IN ('add', 'remove')),
			discord_user_id TEXT,
			last_nickname TEXT,
			requester_user_id TEXT NOT NULL,
			guild_id TEXT NOT NULL,
			requested_at TEXT NOT NULL
		);
	`);
	return database;
}

function readJsonArray(filePath) {
	try {
		const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		return Array.isArray(value) ? value : [];
	} catch (error) {
		if (error.code === 'ENOENT') return [];
		throw error;
	}
}

function readWhitelist(serverConfig) {
	return readJsonArray(minecraftPaths(serverConfig).whitelist)
		.filter(entry => entry && entry.name)
		.map(entry => ({ name: String(entry.name), uuid: entry.uuid ? String(entry.uuid) : null }));
}

function readUserCache(serverConfig) {
	return readJsonArray(minecraftPaths(serverConfig).userCache);
}

function getLinks(options = {}) {
	return getDatabase(options).prepare('SELECT * FROM minecraft_links ORDER BY minecraft_name COLLATE NOCASE').all();
}

function getLink(nameOrUuid, options = {}) {
	return getDatabase(options).prepare(`
		SELECT * FROM minecraft_links WHERE minecraft_name = ? COLLATE NOCASE OR minecraft_uuid = ? LIMIT 1
	`).get(nameOrUuid, nameOrUuid);
}

function getQueue(options = {}) {
	return getDatabase(options).prepare('SELECT * FROM minecraft_whitelist_queue ORDER BY requested_at, minecraft_name COLLATE NOCASE').all();
}

function clearQueuedOperation(minecraftName, options = {}) {
	return getDatabase(options).prepare(
		'DELETE FROM minecraft_whitelist_queue WHERE minecraft_name = ? COLLATE NOCASE',
	).run(minecraftName).changes;
}

function queueWhitelistOperation(operation, options = {}) {
	const name = normalizeMinecraftName(operation.minecraftName);
	getDatabase(options).prepare(`
		INSERT INTO minecraft_whitelist_queue (
			minecraft_name, action, discord_user_id, last_nickname, requester_user_id, guild_id, requested_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(minecraft_name) DO UPDATE SET
			action = excluded.action,
			discord_user_id = excluded.discord_user_id,
			last_nickname = excluded.last_nickname,
			requester_user_id = excluded.requester_user_id,
			guild_id = excluded.guild_id,
			requested_at = excluded.requested_at
	`).run(
		name,
		operation.action,
		operation.discordUserId || null,
		operation.lastNickname || null,
		operation.requesterUserId,
		operation.guildId,
		new Date().toISOString(),
	);
	return name;
}

function responseRejected(action, response) {
	const value = String(response || '');
	return action === 'add'
		? /could not add|does not exist|unknown player|invalid/i.test(value)
		: /could not remove|unknown player|invalid/i.test(value);
}

function upsertLink(operation, uuid, options = {}) {
	const db = getDatabase(options);
	if (uuid) {
		const existing = db.prepare('SELECT minecraft_name FROM minecraft_links WHERE minecraft_uuid = ?').get(uuid);
		if (existing && existing.minecraft_name.toLowerCase() !== operation.minecraftName.toLowerCase()) {
			db.prepare('DELETE FROM minecraft_links WHERE minecraft_uuid = ?').run(uuid);
		}
	}
	db.prepare(`
		INSERT INTO minecraft_links (minecraft_name, minecraft_uuid, discord_user_id, last_nickname, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(minecraft_name) DO UPDATE SET
			minecraft_uuid = COALESCE(excluded.minecraft_uuid, minecraft_links.minecraft_uuid),
			discord_user_id = excluded.discord_user_id,
			last_nickname = excluded.last_nickname,
			updated_at = excluded.updated_at
	`).run(operation.minecraftName, uuid, operation.discordUserId, operation.lastNickname || null, new Date().toISOString());
}

async function applyWhitelistOperation(serverConfig, operation, options = {}) {
	const name = normalizeMinecraftName(operation.minecraftName);
	const rconSend = options.rconSend || (command => sendRcon(serverConfig, command));
	let whitelistBefore = null;
	if (operation.action === 'remove') {
		try {
			whitelistBefore = (options.readWhitelist || readWhitelist)(serverConfig)
				.find(entry => entry.name.toLowerCase() === name.toLowerCase());
		} catch {
			// The RCON removal can still succeed if the local file is temporarily unreadable.
		}
	}
	const response = await rconSend(`whitelist ${operation.action} ${name}`);
	if (responseRejected(operation.action, response)) throw new WhitelistRejectedError(String(response).slice(0, 300));
	await rconSend('whitelist reload');

	if (operation.action === 'add') {
		const applied = (options.readWhitelist || readWhitelist)(serverConfig)
			.find(entry => entry.name.toLowerCase() === name.toLowerCase());
		upsertLink({ ...operation, minecraftName: applied?.name || name }, applied?.uuid || null, options);
	} else {
		getDatabase(options).prepare(`
			DELETE FROM minecraft_links
			WHERE minecraft_name = ? COLLATE NOCASE OR (? IS NOT NULL AND minecraft_uuid = ?)
		`).run(name, whitelistBefore?.uuid || null, whitelistBefore?.uuid || null);
	}
	return { name, action: operation.action, response };
}

async function processWhitelistQueue(serverConfig, options = {}) {
	const db = getDatabase(options);
	const rows = getQueue(options);
	const results = [];
	for (const row of rows) {
		const operation = {
			minecraftName: row.minecraft_name,
			action: row.action,
			discordUserId: row.discord_user_id,
			lastNickname: row.last_nickname,
		};
		try {
			await applyWhitelistOperation(serverConfig, operation, options);
			db.prepare('DELETE FROM minecraft_whitelist_queue WHERE minecraft_name = ? COLLATE NOCASE').run(row.minecraft_name);
			results.push({ ...row, status: 'applied' });
		} catch (error) {
			if (error instanceof RconUnavailableError || /password environment variable/.test(error.message)) {
				results.push({ ...row, status: 'unavailable', error });
				break;
			}
			if (error instanceof WhitelistRejectedError) {
				db.prepare('DELETE FROM minecraft_whitelist_queue WHERE minecraft_name = ? COLLATE NOCASE').run(row.minecraft_name);
				results.push({ ...row, status: 'rejected', error });
				if (options.onRejected) await options.onRejected(row, error);
				continue;
			}
			results.push({ ...row, status: 'error', error });
		}
	}
	return results;
}

function closeDatabase() {
	if (database) database.close();
	database = null;
	databasePath = null;
}

module.exports = {
	WhitelistRejectedError,
	applyWhitelistOperation,
	clearQueuedOperation,
	closeDatabase,
	getDatabase,
	getLink,
	getLinks,
	getQueue,
	normalizeMinecraftName,
	processWhitelistQueue,
	queueWhitelistOperation,
	readUserCache,
	readWhitelist,
};
