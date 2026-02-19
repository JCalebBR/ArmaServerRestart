const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { searchOperations, getOperationScoreboard } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.operation.name)
		.setDescription(strings.commands.operation.desc)
		.addStringOption(option =>
			option.setName(strings.commands.operation.args.first.name)
				.setDescription(strings.commands.operation.args.first.desc)
				.setRequired(true)
				.setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();

		// Fetch matching operations from the database
		const results = searchOperations(focusedValue);

		// Format them for the Discord UI
		// We pack the value with a pipe | so we can easily split it later
		const choices = results.map(op => ({
			name: `${op.operation_date} - ${op.operation_type}`,
			value: `${op.operation_date}|${op.operation_type}`,
		}));

		await interaction.respond(choices);
	},

	async execute(interaction) {
		await interaction.deferReply({ ephemeral: false });

		const targetOp = interaction.options.getString('target');

		// Split our packed string back into Date and Type
		const [selectedDate, selectedType] = targetOp.split('|');

		if (!selectedDate || !selectedType) {
			return interaction.editReply(strings.errors.genericError({ message: 'Invalid operation selected. Please use the autocomplete suggestions.' }));
		}

		// Fetch the specific scoreboard
		let opData = [];
		try {
			opData = getOperationScoreboard(selectedDate, selectedType);
		} catch (error) {
			console.error(error);
			return interaction.editReply(strings.errors.genericError({ message: 'Failed to fetch the operation from the database.' }));
		}

		if (opData.length === 0) {
			return interaction.editReply(`📭 No data found for **${selectedType}** on **${selectedDate}**.\n\nUse the **${strings.ui.selectTypePlaceholder}** option to search by operation type.`);
		}

		// Build the tabular ANSI string (using our 2-line stacked layout)
		let tableStr = "```ansi\n";
		opData.forEach((p, index) => {
			const overallRank = index + 1;

			let rankStr = `${overallRank}.`.padStart(3, ' ');
			if (overallRank === 1) rankStr = "🥇 ";
			if (overallRank === 2) rankStr = "🥈 ";
			if (overallRank === 3) rankStr = "🥉 ";

			const name = p.name;
			const stats = `🪖 ${p.inf_kills} 🚗 ${p.soft_veh} 🚚 ${p.armor_veh} ✈️ ${p.air} 💀 ${p.deaths} ∑ ${p.score}`;

			if (overallRank <= 3) {
				tableStr += `\u001b[1m${rankStr}${name}\u001b[0m\n`;
				tableStr += `   └ ${stats}\n`;
			} else {
				tableStr += `${rankStr}${name}\n`;
				tableStr += `   └ ${stats}\n`;
			}
		});
		tableStr += "```";

		// Create the updated embed
		const opEmbed = new EmbedBuilder()
			.setTitle(`⚔️ After Action Report: ${selectedType}`)
			.setColor(0x00AAFF)
			.setDescription(`**Date:** ${selectedDate}\n**Total Players Deployed:** ${opData.length}\n\n${tableStr}`)
			.setFooter(strings.ui.statsFooter);

		await interaction.editReply({ embeds: [opEmbed] });
	},
};