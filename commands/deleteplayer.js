const { SlashCommandBuilder } = require('discord.js');
const { searchPlayerNames, deletePlayer } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.deleteplayer.name)
		.setDescription(strings.commands.deleteplayer.desc)
		.addStringOption(option =>
			option.setName(strings.commands.deleteplayer.args.first.name)
				.setDescription(strings.commands.deleteplayer.args.first.desc)
				.setRequired(true)
				.setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();
		const results = searchPlayerNames(focusedValue);

		const choices = results.map(row => ({
			name: row.player_name,
			value: row.player_name,
		}));

		await interaction.respond(choices);
	},

	async execute(interaction) {
		await interaction.deferReply({ ephemeral: true });

		const targetName = interaction.options.getString('target_name');

		try {
			const rowsDeleted = deletePlayer(targetName);

			if (rowsDeleted === 0) {
				return interaction.editReply(strings.errors.genericError({ message: `Could not find any records for "**${targetName}**" in the database.` }));
			}

			return interaction.editReply(`✅ **Success!** Purged all ${rowsDeleted} operation record(s) for "**${targetName}**" from the database.`);

		} catch (error) {
			console.error(error);
			return interaction.editReply(strings.errors.genericError({ message: `An error occurred while deleting: ${error.message}` }));
		}
	},
};