const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getInactivePlayers } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.inactive.name)
		.setDescription(strings.commands.inactive.desc)
		.addIntegerOption(option =>
			option.setName(strings.commands.inactive.args.first.name)
				.setDescription(strings.commands.inactive.args.first.desc)
				.setRequired(false)
				.setMinValue(1),
		),

	async execute(interaction) {
		await interaction.deferReply({ ephemeral: true });

		const days = interaction.options.getInteger('days') || 30;

		// Calculate the threshold date in native JavaScript
		const thresholdDate = new Date();
		thresholdDate.setDate(thresholdDate.getDate() - days);
		const dateString = thresholdDate.toISOString().split('T')[0];

		let inactivePlayers = [];
		try {
			inactivePlayers = getInactivePlayers(dateString);
		} catch (error) {
			console.error(error);
			return interaction.editReply(strings.errors.genericError({ message: 'Failed to check attendance data.' }));
		}

		if (inactivePlayers.length === 0) {
			return interaction.editReply(`✅ No inactive players found in the last **${days}** days.`);
		}

		// Format the output list cleanly
		const playerList = inactivePlayers.map(p => `• **${p.player_name}** - Last seen: \`${p.last_seen}\``).join('\n');

		const embed = new EmbedBuilder()
			.setTitle(`⚠️ Inactivity Report (> ${days} Days)`)
			.setColor(0xFF0000)
			.setDescription(`Found **${inactivePlayers.length}** player(s) who have not deployed since **${dateString}**.\n\n${playerList}`)
			.setFooter({ text: 'Consider reaching out to these members.' });

		return interaction.editReply({ embeds: [embed] });
	},
};