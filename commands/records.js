const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getHighestRecords, getUnitRecords } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.records.name)
		.setDescription(strings.commands.records.desc),

	async execute(interaction) {
		await interaction.deferReply();

		let individualRecords, unitRecords;
		try {
			individualRecords = getHighestRecords();
			unitRecords = getUnitRecords();
		} catch (error) {
			console.error(error);
			return interaction.editReply(strings.errors.genericError({ message: 'Failed to fetch records from the database.' }));
		}

		// Verify we actually have data (if total_ops is 0, the DB is empty)
		if (!unitRecords.totals || !unitRecords.totals.total_ops) {
			return interaction.editReply(strings.errors.noRecords('player'));
		}

		const totals = unitRecords.totals;
		const maxOp = unitRecords.maxPlayers;
		const minOp = unitRecords.minPlayers;

		const embed = new EmbedBuilder()
			.setTitle('🎖️ Unit Hall of Fame & Global Records')
			.setColor(0xFFD700)

			// --- SECTION 1: INDIVIDUAL SPIKES & ATTENDANCE ---
			.addFields(
				{ name: '━━━━━━ INDIVIDUAL RECORDS ━━━━━━', value: '*Highest single-operation spikes achieved by personnel.*' },
				{ name: 'Most 🪖', value: `**${individualRecords.inf_kills.player_name}** - ${individualRecords.inf_kills.max_val} Kills\n└ *${individualRecords.inf_kills.operation_date}*`, inline: true },
				{ name: 'Most 🚗', value: `**${individualRecords.soft_veh.player_name}** - ${individualRecords.soft_veh.max_val} Kills\n└ *${individualRecords.soft_veh.operation_date}*`, inline: true },
				{ name: 'Most 🚚', value: `**${individualRecords.armor_veh.player_name}** - ${individualRecords.armor_veh.max_val} Kills\n└ *${individualRecords.armor_veh.operation_date}*`, inline: true },

				{ name: 'Most ✈️', value: `**${individualRecords.air.player_name}** - ${individualRecords.air.max_val} Kills\n└ *${individualRecords.air.operation_date}*`, inline: true },
				{ name: 'Most 💀', value: `**${individualRecords.deaths.player_name}** - ${individualRecords.deaths.max_val} Deaths\n└ *${individualRecords.deaths.operation_date}*`, inline: true },
				{ name: 'Highest ∑', value: `**${individualRecords.score.player_name}** - ${individualRecords.score.max_val} Points\n└ *${individualRecords.score.operation_date}*`, inline: true },

				{ name: 'Largest Operation 📈', value: `**${maxOp.player_count} Players**\n└ *${maxOp.operation_type} (${maxOp.operation_date})*`, inline: true },
				{ name: 'Smallest Operation 📉', value: `**${minOp.player_count} Players**\n└ *${minOp.operation_type} (${minOp.operation_date})*`, inline: true },
				{ name: '\u200B', value: '\u200B', inline: true },

				// --- SECTION 2: GLOBAL UNIT TOTALS ---
				{ name: '━━━━━━ ALL-TIME UNIT RECORDS ━━━━━━', value: `*Cumulative statistics across all **${totals.total_ops}** logged operations.*` },
				{ name: 'Total 🪖', value: `**${totals.total_inf.toLocaleString()}**`, inline: true },
				{ name: 'Total 🚗🚚', value: `**${(totals.total_soft + totals.total_armor).toLocaleString()}**`, inline: true },
				{ name: 'Total ✈️', value: `**${totals.total_air.toLocaleString()}**`, inline: true },

				{ name: 'Total 💀', value: `**${totals.total_deaths.toLocaleString()}**`, inline: true },
				{ name: 'Total ∑', value: `**${totals.total_score.toLocaleString()}**`, inline: true },
				{ name: '\u200B', value: '\u200B', inline: true },
			)
			.setFooter(strings.ui.statsFooter)
			.setTimestamp();

		return interaction.editReply({ embeds: [embed] });
	},
};