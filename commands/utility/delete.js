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

module.exports = {
	data: new SlashCommandBuilder()
		.setName('delete')
		.setDescription('Permanently deletes a mission file from the server')
		.addStringOption(option =>
			option.setName('mission')
				.setDescription('The file to delete')
				.setRequired(true)
				.setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused().toLowerCase();
		let choices = [];

		try {
			// Read dir and filter for .pbo
			const files = fs.readdirSync(TARGET_DIR).filter(f => f.endsWith('.pbo'));
			choices = files.filter(file => file.toLowerCase().includes(focusedValue));
		} catch (error) {
			console.error(error);
		}

		// Limit to 25 choices (Discord API max)
		await interaction.respond(
			choices.slice(0, 25).map(choice => ({ name: choice, value: choice })),
		);
	},

	async execute(interaction) {
		const fileName = interaction.options.getString('mission');

		// Security: Prevent directory traversal
		const safeName = path.basename(fileName);
		const filePath = path.join(TARGET_DIR, safeName);

		if (!fs.existsSync(filePath)) {
			return interaction.reply({
				content: `❌ File **${safeName}** not found.`,
				ephemeral: true,
			});
		}

		// --- CONFIRMATION BUTTONS ---
		const confirmButton = new ButtonBuilder()
			.setCustomId('confirm_delete')
			.setLabel('🗑️ Delete Forever')
			.setStyle(ButtonStyle.Danger);

		const cancelButton = new ButtonBuilder()
			.setCustomId('cancel_delete')
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary);

		const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

		const response = await interaction.reply({
			content: `⚠️ **WARNING**: Are you sure you want to delete **${safeName}**?\nThis action cannot be undone.`,
			components: [row],
			ephemeral: true
		});

		const collector = response.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 15_000
		});

		collector.on('collect', async i => {
			if (i.customId === 'confirm_delete') {
				try {
					fs.unlinkSync(filePath);
					await i.update({
						content: `✅ **${safeName}** has been deleted.`,
						components: [],
					});
				} catch (error) {
					await i.update({
						content: `❌ Error deleting file: ${error.message}`,
						components: [],
					});
				}
			} else {
				await i.update({
					content: '🚫 Deletion cancelled.',
					components: [],
				});
			}
		});

		collector.on('end', collected => {
			if (collected.size === 0) {
				interaction.editReply({
					content: '⏳ Timed out. Deletion cancelled.',
					components: [],
				}).catch(() => {
					console.error('Error removing buttons');
				});
			}
		});
	},
};