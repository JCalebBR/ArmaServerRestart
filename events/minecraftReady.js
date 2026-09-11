const { Events } = require('discord.js');
const { createMinecraftServices } = require('../utils/minecraftServices');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		try {
			client.minecraftServices = createMinecraftServices(client);
			client.minecraftServices.start();
			console.log('[Minecraft] Chat, whitelist, and restart services started.');
		} catch (error) {
			console.warn('[Minecraft] Services were not started:', error.message);
		}
	},
};
