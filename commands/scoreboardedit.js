const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
	searchOperations,
	searchPlayersInOperation,
	getPlayerOperationRecord,
	updatePlayerOperationRecord,
} = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.scoreboardedit.name)
		.setDescription(strings.commands.scoreboardedit.desc)
		.addStringOption(option =>
			option.setName(strings.commands.scoreboardedit.args.first.name)
				.setDescription(strings.commands.scoreboardedit.args.first.desc)
				.setRequired(true)
				.setAutocomplete(true),
		)
		.addStringOption(option =>
			option.setName(strings.commands.scoreboardedit.args.second.name)
				.setDescription(strings.commands.scoreboardedit.args.second.desc)
				.setRequired(true)
				.setAutocomplete(true),
		)
		.addIntegerOption(opt => opt.setName('infantry').setDescription('New Infantry Kills value').setRequired(false))
		.addIntegerOption(opt => opt.setName('soft_vehicles').setDescription('New Soft Vehicle Kills value').setRequired(false))
		.addIntegerOption(opt => opt.setName('armored_vehicles').setDescription('New Armored Vehicle Kills value').setRequired(false))
		.addIntegerOption(opt => opt.setName('air').setDescription('New Air Kills value').setRequired(false))
		.addIntegerOption(opt => opt.setName('deaths').setDescription('New Deaths value').setRequired(false))
		.addIntegerOption(opt => opt.setName('score').setDescription('New Score value').setRequired(false)),

	async autocomplete(interaction) {
		const focusedOption = interaction.options.getFocused(true);

		if (focusedOption.name === 'operation') {
			const results = searchOperations(focusedOption.value);
			const choices = results.map(op => ({
				name: `${op.operation_date} - ${op.operation_type}`,
				value: `${op.operation_date}|${op.operation_type}`,
			}));
			return await interaction.respond(choices);
		}

		if (focusedOption.name === 'player') {
			// Peek at what they put in the operation box
			const targetOp = interaction.options.getString('operation');

			// If they haven't picked an operation yet, gently warn them
			if (!targetOp) {
				return await interaction.respond([
					{ name: '⚠️ Please select an operation first!', value: 'ERROR_NO_OP' },
				]);
			}

			// Split the operation string to get our DB parameters
			const [opDate, opType] = targetOp.split('|');

			// Search ONLY within that specific operation
			const results = searchPlayersInOperation(opDate, opType, focusedOption.value);

			const choices = results.map(row => ({
				name: row.player_name,
				value: row.player_name,
			}));
			return await interaction.respond(choices);
		}
	},

	async execute(interaction) {
		await interaction.deferReply({ ephemeral: true });

		const targetOp = interaction.options.getString('operation');
		const targetPlayer = interaction.options.getString('player');

		// Catch the dummy error option
		if (targetPlayer === 'ERROR_NO_OP') {
			return interaction.editReply(strings.errors.noOp);
		}

		const [opDate, opType] = targetOp.split('|');

		if (!opDate || !opType) {
			return interaction.editReply(strings.errors.invalidOp);
		}

		const record = getPlayerOperationRecord(opDate, opType, targetPlayer);

		if (!record) {
			return interaction.editReply(strings.errors.genericError({ message: `Could not find a operation record for **${targetPlayer}** on **${opDate}** (${opType}).` }));
		}

		const updates = {
			inf_kills: interaction.options.getInteger('infantry'),
			soft_veh: interaction.options.getInteger('soft_vehicles'),
			armor_veh: interaction.options.getInteger('armored_vehicles'),
			air: interaction.options.getInteger('air'),
			deaths: interaction.options.getInteger('deaths'),
			score: interaction.options.getInteger('score'),
		};

		const hasUpdates = Object.values(updates).some(val => val !== null);
		if (!hasUpdates) {
			return interaction.editReply(strings.errors.noUpdates);
		}

		try {
			updatePlayerOperationRecord(record.id, updates);

			const embed = new EmbedBuilder()
				.setTitle(`🔧 Record Updated: ${targetPlayer}`)
				.setColor(0x00FF00)
				.setDescription(`Successfully modified stats for **${opType}** on ${opDate}.`)
				.addFields(
					{ name: strings.stats.infantry, value: `${record.inf_kills} ➔ **${updates.inf_kills ?? record.inf_kills}**`, inline: true },
					{ name: strings.stats.softVeh, value: `${record.soft_veh} ➔ **${updates.soft_veh ?? record.soft_veh}**`, inline: true },
					{ name: strings.stats.armorVeh, value: `${record.armor_veh} ➔ **${updates.armor_veh ?? record.armor_veh}**`, inline: true },
					{ name: strings.stats.air, value: `${record.air} ➔ **${updates.air ?? record.air}**`, inline: true },
					{ name: strings.stats.deaths, value: `${record.deaths} ➔ **${updates.deaths ?? record.deaths}**`, inline: true },
					{ name: strings.stats.score, value: `${record.score} ➔ **${updates.score ?? record.score}**`, inline: true },
				);

			return interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error(error);
			return interaction.editReply({ content: strings.errors.genericError({ message: `An error occurred while updating the record: ${error.message}` }), embeds: [] });
		}
	},
};