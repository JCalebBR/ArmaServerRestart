const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const TARGET_DIR = 'C:\\Games\\ArmaA3\\mpmissions';

/**
 * Helper: Downloads a file from a URL to a local path
 */
async function downloadFile(url, destPath) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

	const arrayBuffer = await response.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);

	fs.writeFileSync(destPath, buffer);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('upload')
		.setDescription('Uploads a .pbo mission file to the server')
		.addAttachmentOption(option =>
			option.setName('file')
				.setDescription('The .pbo file to upload')
				.setRequired(true),
		),

	async execute(interaction) {
		const attachment = interaction.options.getAttachment('file');
		const fileName = attachment.name;

		// 1. Validation: Check File Extension
		if (!fileName.toLowerCase().endsWith('.pbo')) {
			return interaction.reply({
				content: '❌ Rejected. Only **.pbo** files are allowed.',
				ephemeral: true,
			});
		}

		const destPath = path.join(TARGET_DIR, fileName);

		// Security: Prevent directory traversal (e.g. "../../windows/system32")
		if (!destPath.startsWith(TARGET_DIR)) {
			return interaction.reply({ content: '❌ Invalid filename.', ephemeral: true });
		}

		// We defer immediately because downloading might take a few seconds
		await interaction.deferReply({ ephemeral: true });

		// 2. Check if File Exists
		if (fs.existsSync(destPath)) {
			// --- CONFLICT DETECTED: ASK USER ---

			const confirmButton = new ButtonBuilder()
				.setCustomId('confirm')
				.setLabel('Overwrite')
				.setStyle(ButtonStyle.Danger);

			const cancelButton = new ButtonBuilder()
				.setCustomId('cancel')
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Secondary);

			const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

			const response = await interaction.editReply({
				content: `⚠️ **${fileName}** already exists on the server.\nDo you want to overwrite it?`,
				components: [row],
			});

			// Create a "collector" to listen for the button click
			// It waits 15 seconds for a click, then gives up.
			const collector = response.createMessageComponentCollector({
				componentType: ComponentType.Button,
				time: 15_000,
			});

			collector.on('collect', async i => {
				if (i.customId === 'confirm') {
					// User clicked Overwrite
					await i.update({ content: `🔄 Overwriting **${fileName}**...`, components: [] });

					try {
						await downloadFile(attachment.url, destPath);
						await i.editReply(`✅ **${fileName}** uploaded successfully (Overwritten).`);
					} catch (error) {
						console.error(error);
						await i.editReply(`❌ Upload failed: ${error.message}`);
					}
				} else {
					// User clicked Cancel
					await i.update({ content: '🚫 Upload cancelled.', components: [] });
				}
			});

			collector.on('end', collected => {
				// If user didn't click anything after 15s
				if (collected.size === 0) {
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
			await interaction.editReply(`❌ Upload failed: ${error.message}`);
		}
	},
};