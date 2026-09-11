const fs = require('fs');
const path = require('path');
const { minecraftPaths } = require('./minecraft');
const { getLinks, readUserCache, readWhitelist } = require('./minecraftState');

function humanizeIdentifier(identifier) {
	const [namespace, value = namespace] = String(identifier).split(':');
	const label = value.replace(/^.*\//, '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
	const result = namespace && namespace !== 'minecraft' ? `${label} (${namespace})` : label;
	return result.slice(0, 120);
}

function formatDurationTicks(ticks) {
	let seconds = Math.floor((Number(ticks) || 0) / 20);
	const days = Math.floor(seconds / 86400);
	seconds %= 86400;
	const hours = Math.floor(seconds / 3600);
	seconds %= 3600;
	const minutes = Math.floor(seconds / 60);
	const parts = [];
	if (days) parts.push(`${days}d`);
	if (hours || days) parts.push(`${hours}h`);
	parts.push(`${minutes}m`);
	return parts.join(' ');
}

function sumValues(value) {
	return Object.values(value || {}).reduce((total, count) => total + (Number(count) || 0), 0);
}

function topEntries(value, limit = 15) {
	return Object.entries(value || {})
		.map(([id, count]) => ({ id, label: humanizeIdentifier(id), count: Number(count) || 0 }))
		.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
		.slice(0, limit);
}

function parseMinecraftStats(document) {
	const stats = document?.stats || {};
	const custom = stats['minecraft:custom'] || {};
	const distance = Object.entries(custom)
		.filter(([key]) => /_one_cm$/.test(key))
		.reduce((total, [, value]) => total + (Number(value) || 0), 0);
	return {
		summary: {
			playTime: formatDurationTicks(custom['minecraft:play_time']),
			deaths: Number(custom['minecraft:deaths']) || 0,
			playerKills: Number(custom['minecraft:player_kills']) || 0,
			mobKills: sumValues(stats['minecraft:killed']),
			blocksMined: sumValues(stats['minecraft:mined']),
			itemsCrafted: sumValues(stats['minecraft:crafted']),
			itemsUsed: sumValues(stats['minecraft:used']),
			distanceKm: distance / 100000,
			damageDealt: (Number(custom['minecraft:damage_dealt']) || 0) / 10,
			damageTaken: (Number(custom['minecraft:damage_taken']) || 0) / 10,
		},
		categories: {
			'Mobs Killed': topEntries(stats['minecraft:killed']),
			'Blocks Mined': topEntries(stats['minecraft:mined']),
			'Items Crafted': topEntries(stats['minecraft:crafted']),
			'Items Used': topEntries(stats['minecraft:used']),
		},
	};
}

function resolvePlayer(serverConfig, requestedName, options = {}) {
	const lower = String(requestedName || '').trim().toLowerCase();
	const whitelist = (options.readWhitelist || readWhitelist)(serverConfig);
	const cache = (options.readUserCache || readUserCache)(serverConfig);
	const links = options.links || getLinks(options);
	const match = whitelist.find(item => item.name.toLowerCase() === lower)
		|| cache.find(item => String(item.name || '').toLowerCase() === lower);
	const link = links.find(item => item.minecraft_name.toLowerCase() === lower
		|| (match?.uuid && item.minecraft_uuid?.toLowerCase() === match.uuid.toLowerCase()));
	const uuid = match?.uuid || link?.minecraft_uuid;
	if (!uuid) throw new Error(`No UUID was found for ${requestedName}. The player may not have joined or been applied to the whitelist yet.`);
	return { name: match?.name || link?.minecraft_name || requestedName, uuid, link };
}

function readPlayerStats(serverConfig, requestedName, options = {}) {
	const player = resolvePlayer(serverConfig, requestedName, options);
	const filePath = path.join(minecraftPaths(serverConfig).stats, `${player.uuid}.json`);
	let document;
	try { document = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
	catch (error) {
		if (error.code === 'ENOENT') throw new Error(`No saved statistics were found for ${player.name}.`);
		throw new Error(`Could not read statistics for ${player.name}: ${error.message}`);
	}
	return {
		...player,
		...parseMinecraftStats(document),
		filePath,
		modifiedAt: fs.statSync(filePath).mtime,
	};
}

function listKnownPlayers(serverConfig, options = {}) {
	const names = new Set();
	for (const item of (options.readWhitelist || readWhitelist)(serverConfig)) names.add(item.name);
	for (const item of (options.readUserCache || readUserCache)(serverConfig)) if (item.name) names.add(item.name);
	for (const item of (options.links || getLinks(options))) names.add(item.minecraft_name);
	return [...names].sort((left, right) => left.localeCompare(right));
}

module.exports = {
	formatDurationTicks,
	humanizeIdentifier,
	listKnownPlayers,
	parseMinecraftStats,
	readPlayerStats,
	resolvePlayer,
	topEntries,
};
