const { SlashCommandBuilder } = require('discord.js');
const { searchPlayerNames, renamePlayer } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.rename.name)
		.setDescription(strings.commands.rename.desc)
		.addStringOption(option =>
			option.setName(strings.commands.rename.args.first.name)
				.setDescription(strings.commands.rename.args.first.desc)
				.setRequired(true)
				.setAutocomplete(true),
		)
		.addStringOption(option =>
			option.setName(strings.commands.rename.args.second.name)
				.setDescription(strings.commands.rename.args.second.desc)
				.setRequired(true),
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
		// Keeping this ephemeral so admins can fix typos quietly
		await interaction.deferReply({ ephemeral: true });

		const oldName = interaction.options.getString('old_name');

		// Let's ensure the new name is perfectly Title Cased just like our ingestion script
		const newNameRaw = interaction.options.getString('new_name').trim();
		const newName = newNameRaw
			.split(' ')
			.map(word => word.length === 0 ? '' : word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');

		if (oldName.toLowerCase() === newName.toLowerCase()) {
			return interaction.editReply('⚠️ The old name and the new name are the same.');
		}

		try {
			// Run the update query
			const rowsChanged = renamePlayer(oldName, newName);

			if (rowsChanged === 0) {
				return interaction.editReply(`❌ Could not find any records for "**${oldName}**" in the database.`);
			}

			return interaction.editReply(`✅ **Success!** Renamed "**${oldName}**" to "**${newName}**".\nUpdated ${rowsChanged} operation record(s). Their stats have been merged.`);

		} catch (error) {
			console.error(error);
			return interaction.editReply(`❌ An error occurred while updating the database: ${error.message}`);
		}
	},
};