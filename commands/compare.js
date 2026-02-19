const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { searchPlayerNames, getPlayerStats } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.compare.name)
		.setDescription(strings.commands.compare.desc)
		.addStringOption(option =>
			option.setName('player1').setDescription('First player').setRequired(true).setAutocomplete(true),
		)
		.addStringOption(option =>
			option.setName('player2').setDescription('Second player').setRequired(true).setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();
		const results = searchPlayerNames(focusedValue);
		const choices = results.map(row => ({ name: row.player_name, value: row.player_name }));
		await interaction.respond(choices);
	},

	async execute(interaction) {
		await interaction.deferReply();

		const p1Name = interaction.options.getString('player1');
		const p2Name = interaction.options.getString('player2');

		if (p1Name === p2Name) return interaction.editReply(strings.errors.genericError({ message: 'You cannot compare a player to themselves!' }));

		// We pass 'IGNORE' for the date prefixes since we only care about all-time stats here
		const p1 = getPlayerStats(p1Name, 'IGNORE', 'IGNORE');
		const p2 = getPlayerStats(p2Name, 'IGNORE', 'IGNORE');

		if (!p1 || !p2) {
			return interaction.editReply(strings.errors.genericError({ message: 'Could not find one or both players in the database.' }));
		}

		// Helper function to bold the winner
		const compareStat = (stat1, stat2) => {
			if (stat1 > stat2) return `🏆 **${stat1}** - ${stat2}`;
			if (stat2 > stat1) return `${stat1} - **${stat2}** 🏆`;
			return `${stat1} - ${stat2} 🤝`;
		};

		// For deaths, lower is better!
		const compareDeaths = (stat1, stat2) => {
			if (stat1 < stat2) return `🏆 **${stat1}** - ${stat2}`;
			if (stat2 < stat1) return `${stat1} - **${stat2}** 🏆`;
			return `${stat1} - ${stat2} 🤝`;
		};

		const embed = new EmbedBuilder()
			.setTitle(`⚖️ Service Record Comparison`)
			.setColor(0xFF4500)
			.setDescription(`**${p1.name}** vs **${p2.name}**`)
			.addFields(
				{ name: 'Operations', value: compareStat(p1.operations_attended, p2.operations_attended), inline: false },
				{ name: '🪖', value: compareStat(p1.inf_kills, p2.inf_kills), inline: true },
				{ name: '🚗', value: compareStat(p1.soft_veh, p2.soft_veh), inline: true },
				{ name: '🚚', value: compareStat(p1.armor_veh, p2.armor_veh), inline: true },
				{ name: '✈️', value: compareStat(p1.air, p2.air), inline: true },
				{ name: '💀', value: compareDeaths(p1.deaths, p2.deaths), inline: true },
				{ name: '∑', value: compareStat(p1.score, p2.score), inline: true },
			)
			.setFooter(strings.ui.statsFooter);

		return interaction.editReply({ embeds: [embed] });
	},
};