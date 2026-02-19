const { Events, ActivityType } = require('discord.js');
const { GameDig } = require('gamedig');
const fs = require('fs');
const path = require('path');

// Adjust path if your structure is different.
// If this file is in 'events/', then '../servers.json' looks in the root.
const CONFIG_PATH = path.join(__dirname, '../servers.json');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);

		// Run immediately on startup
		updateServerStatus(client);

		// Then repeat every 60 seconds
		setInterval(() => {
			updateServerStatus(client);
		}, 60000);
	},
};

async function updateServerStatus(client) {
	try {
		// 1. Load Config
		const data = fs.readFileSync(CONFIG_PATH, 'utf8');
		const config = JSON.parse(data);
		const server = config.servers['Black Templars'];

		if (!server) return;

		// 2. Determine Ports (Using the logic we fixed earlier)
		// If queryPort exists in JSON, use it. Otherwise fallback to port.
		const qPort = server.queryPort || server.port;
		const qHost = server.host || '127.0.0.1';

		// 3. Query the Server
		const state = await GameDig.query({
			type: 'arma3',
			host: qHost,
			port: qPort,
			maxAttempts: 2,
			socketTimeout: 5000,
		});

		// 4. Format the Status
		const playerCount = state.players.length;
		const maxPlayers = state.maxplayers;
		const mapName = state.map;

		const statusText = `${playerCount}/${maxPlayers} Players | ${mapName}`;

		client.user.setPresence({
			activities: [{ name: statusText, type: ActivityType.Playing }],
			status: 'online',
		});

	} catch (e) {
		client.user.setPresence({
			activities: [{ name: 'Server Offline', type: ActivityType.Watching }],
			status: 'dnd',
		});
	}
}