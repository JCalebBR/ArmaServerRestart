const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');

const TARGET_DIR = 'C:\\Games\\ArmaA3\\mpmissions';

async function downloadFile(url, destPath) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

	const arrayBuffer = await response.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);

	fs.writeFileSync(destPath, buffer);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.upload.name)
		.setDescription(strings.commands.upload.desc)
		.addAttachmentOption(option =>
			option.setName(strings.commands.upload.args.first.name)
				.setDescription(strings.commands.upload.args.first.desc)
				.setRequired(true),
		),

	async execute(interaction) {
		const attachment = interaction.options.getAttachment('file');
		const fileName = attachment.name;

		// 1. Validation: Check File Extension
		if (!fileName.toLowerCase().endsWith('.pbo')) {
			return interaction.reply({
				content: strings.errors.invalidFile('.pbo'),
				ephemeral: true,
			});
		}

		const destPath = path.join(TARGET_DIR, fileName);

		// Security: Prevent directory traversal
		if (!destPath.startsWith(TARGET_DIR)) {
			return interaction.reply({ content: strings.errors.invalidFile('.pbo'), ephemeral: true });
		}

		// Deferred Reply, so the user can see the progress
		await interaction.deferReply();

		// 2. Check if File Exists
		if (fs.existsSync(destPath)) {
			// --- CONFLICT DETECTED: ASK USER ---

			const confirmButton = new ButtonBuilder()
				.setCustomId('confirm')
				.setLabel(strings.ui.confirmBtn)
				.setStyle(ButtonStyle.Danger);

			const cancelButton = new ButtonBuilder()
				.setCustomId('cancel')
				.setLabel(strings.ui.cancelBtn)
				.setStyle(ButtonStyle.Secondary);

			const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

			const response = await interaction.editReply({
				content: `⚠️ **${fileName}** already exists on the server.\nDo you want to overwrite it?`,
				components: [row],
			});

			const collector = response.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: 15_000,
			});

			collector.on('collect', async i => {
				// --- CHANGE 2: Security Check ---
				// Ensure only the person who ran the command can click the buttons
				if (i.user.id !== interaction.user.id) {
					return i.reply({ content: strings.errors.notYourMenu, ephemeral: true });
				}

				if (i.customId === 'confirm') {
					// User clicked Overwrite
					await i.update({ content: `🔄 Overwriting **${fileName}**...`, components: [] });

					try {
						await downloadFile(attachment.url, destPath);
						await i.editReply(`✅ **${fileName}** uploaded successfully (Overwritten).`);
					} catch (error) {
						console.error(error);
						await i.editReply({ content: strings.errors.genericError({ message: `Upload failed: ${error.message}` }), components: [] });
					}
				} else {
					// User clicked Cancel
					await i.update({ content: '🚫 Upload cancelled.', components: [] });
				}
			});

			collector.on('end', collected => {
				// If user didn't click anything after 15s
				if (collected.size === 0) {
					// Use editReply on original interaction since buttons are gone/timed out
					interaction.editReply({ content: '⏳ Timed out. Upload cancelled.', components: [] });
				}
			});

			return;
		}

		// 3. No Conflict: Direct Download
		try {
			await interaction.editReply(`📥 Downloading **${fileName}**...`);
			await downloadFile(attachment.url, destPath);
			await interaction.editReply(`✅ **${fileName}** uploaded successfully.`);
		} catch (error) {
			console.error(error);
			await interaction.editReply({ content: strings.errors.genericError({ message: `Upload failed: ${error.message}` }), components: [] });
		}
	},
};