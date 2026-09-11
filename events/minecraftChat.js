const { Events } = require('discord.js');
const { getMinecraftEntry } = require('../utils/config');
const { relayDiscordMessage } = require('../utils/minecraftChat');

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot || message.webhookId || !message.inGuild()) return;
		let serverConfig;
		try {
			serverConfig = getMinecraftEntry().config;
		} catch {
			return;
		}
		if (message.channelId !== serverConfig.discordChannelId) return;

		try {
			await relayDiscordMessage(serverConfig, message);
		} catch (error) {
			console.warn('[Minecraft Chat] Discord-to-game relay failed:', error.message);
			await message.react('❌').catch(() => undefined);
		}
	},
};
