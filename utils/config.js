const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'servers.json');

function loadConfig() {
	return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function getServerKind(serverConfig) {
	return String(serverConfig?.kind || 'arma3').toLowerCase();
}

function getMinecraftEntries(config = loadConfig()) {
	return Object.entries(config.servers || {}).filter(([, server]) => getServerKind(server) === 'minecraft');
}

function getMinecraftEntry(config = loadConfig()) {
	const entries = getMinecraftEntries(config);
	if (entries.length === 0) throw new Error('No Minecraft server is configured in servers.json.');
	if (entries.length > 1) throw new Error('Only one Minecraft server can be used by the chat and whitelist services.');
	return { name: entries[0][0], config: entries[0][1], fullConfig: config };
}

module.exports = {
	CONFIG_PATH,
	getMinecraftEntries,
	getMinecraftEntry,
	getServerKind,
	loadConfig,
};
