const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');
const { json } = require('stream/consumers');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.backup.name)
		.setDescription(strings.commands.backup.desc),

	async execute(interaction) {
		// This process might take a while, so we defer ephemerally
		await interaction.deferReply({ ephemeral: true });

		let channel;
		try {
			channel = await interaction.client.channels.fetch(process.env.CHANNEL_ID);
		} catch (error) {
			console.warn(error);
			return interaction.editReply('❌ Could not find the channel. Check the CHANNEL_ID in the code.');
		}

		// 1. Ensure the /json folder exists in your project's root directory
		const jsonDir = path.join(__dirname, '..', 'json');
		if (!fs.existsSync(jsonDir)) {
			fs.mkdirSync(jsonDir, { recursive: true });
		}

		await interaction.editReply('🔄 Scanning channel history and downloading files... This might take a minute.');

		let lastId = null;
		let messagesProcessed = 0;
		let filesDownloaded = 0;
		let keepFetching = true;

		// 2. Loop backwards through the channel history 100 messages at a time
		while (keepFetching) {
			const options = { limit: 100 };
			if (lastId) options.before = lastId;

			const messages = await channel.messages.fetch(options);

			// If we get exactly 0 messages back, we've reached the start of the channel
			if (messages.size === 0) {
				keepFetching = false;
				break;
			}

			for (const [id, msg] of messages) {
				// Filter for attached JSON files
				const jsonAttachments = msg.attachments.filter(att => att.name && att.name.endsWith('.json'));
				if (jsonAttachments.length === 0) continue;
				if (msg.reactions.cache.find(r => r.emoji.name === '✅')) continue;
				await msg.react('✅');

				for (const [attId, att] of jsonAttachments) {
					try {
						// Download the file into memory
						const response = await fetch(att.url);
						const arrayBuffer = await response.arrayBuffer();
						const buffer = Buffer.from(arrayBuffer);

						// 3. Handle Duplicate Filenames
						const originalName = att.name;
						const ext = path.extname(originalName);
						const baseName = path.basename(originalName, ext);

						let finalName = originalName;
						let counter = 1;

						// Check if file exists. If yes, append _1, _2, etc.
						while (fs.existsSync(path.join(jsonDir, finalName))) {
							finalName = `${baseName}_${counter}${ext}`;
							counter++;
						}

						// Write to the hard drive
						fs.writeFileSync(path.join(jsonDir, finalName), buffer);
						filesDownloaded++;

					} catch (err) {
						console.error(`Failed to download ${att.name}:`, err);
					}
				}

				// Keep track of the oldest message ID for the next pagination loop
				lastId = msg.id;
				messagesProcessed++;
			}
		}

		await interaction.editReply(`✅ **Backup Complete!**\nScanned **${messagesProcessed}** messages and successfully downloaded **${filesDownloaded}** JSON files into the local \`/json\` folder.`);
	},
};