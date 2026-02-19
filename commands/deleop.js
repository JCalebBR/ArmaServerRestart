const {
	SlashCommandBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	EmbedBuilder
} = require('discord.js');

const { searchOperations, getRecentOperations, getOperationScoreboard, deleteOperation } = require('../utils/db');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('deleteop')
		.setDescription('🚨 Permanently delete an entire operation and all its stats.')
		.addStringOption(option =>
			option.setName('operation')
				.setDescription('Search and select the operation to delete')
				.setRequired(true)
				.setAutocomplete(true)
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();

		let ops;
		// If they haven't typed anything, show the 25 most recent ops
		if (!focusedValue) {
			ops = getRecentOperations();
		} else {
			// Otherwise, search the database for what they are typing
			ops = searchOperations(focusedValue);
		}

		// Format the choices for the Discord UI
		await interaction.respond(
			ops.map(op => ({
				name: `${op.operation_type} (${op.operation_date})`,
				// We pass a hidden value joining them with a pipe "|" so we can split it later
				value: `${op.operation_date}|${op.operation_type}`
			}))
		);
	},

	async execute(interaction) {
		// 1. Get the hidden value from the autocomplete selection
		const selection = interaction.options.getString('operation');
		const [opDate, opType] = selection.split('|');

		if (!opDate || !opType) {
			return interaction.reply({ content: '❌ Invalid operation selected. Please use the autocomplete menu.', ephemeral: true });
		}

		// 2. Check how many records are about to be deleted
		const players = getOperationScoreboard(opDate, opType);
		if (players.length === 0) {
			return interaction.reply({ content: `⚠️ Could not find any data for **${opType}** on **${opDate}**. It may have already been deleted.`, ephemeral: true });
		}

		// 3. Build the Confirmation UI
		const embed = new EmbedBuilder()
			.setTitle('⚠️ Confirm Operation Deletion')
			.setColor(0xFF0000)
			.setDescription(`You are about to **permanently delete** an entire operation from the database.`)
			.addFields(
				{ name: 'Operation Type', value: opType, inline: true },
				{ name: 'Date', value: opDate, inline: true },
				{ name: 'Impact', value: `This will erase stats for **${players.length} players**.`, inline: false }
			)
			.setFooter({ text: 'This action cannot be undone.' });

		const btnCancel = new ButtonBuilder()
			.setCustomId('btn_cancel_delete')
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary);

		const btnConfirm = new ButtonBuilder()
			.setCustomId('btn_confirm_delete')
			.setLabel('Permanently Delete')
			.setStyle(ButtonStyle.Danger);

		const row = new ActionRowBuilder().addComponents(btnCancel, btnConfirm);

		const response = await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

		// 4. Wait for the admin to click a button
		const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000 });

		collector.on('collect', async i => {
			if (i.customId === 'btn_cancel_delete') {
				await i.update({ content: '🚫 Deletion cancelled.', embeds: [], components: [] });
				collector.stop();
			}
			else if (i.customId === 'btn_confirm_delete') {
				try {
					// Execute the database purge
					const deletedRows = deleteOperation(opDate, opType);

					await i.update({
						content: `✅ Successfully deleted **${deletedRows}** player records for **${opType}** on **${opDate}**.`,
						embeds: [],
						components: []
					});
				} catch (error) {
					console.error('Failed to delete operation:', error);
					await i.update({ content: `❌ A database error occurred: ${error.message}`, embeds: [], components: [] });
				}
				collector.stop();
			}
		});

		collector.on('end', collected => {
			// If they let the 30 seconds expire without clicking anything
			if (collected.size === 0) {
				interaction.editReply({ content: '⏳ Deletion request timed out.', embeds: [], components: [] }).catch(() => { });
			}
		});
	},
};