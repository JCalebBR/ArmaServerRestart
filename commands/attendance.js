const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { searchPlayerNames, getPlayerAttendanceDetails, getAllOperationsChronological, getPlayerOperationsChronological, getUnitOperationsPerMonth } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.attendance.name)
		.setDescription(strings.commands.attendance.desc)
		.addStringOption(option =>
			option.setName(strings.commands.attendance.args.first.name)
				.setDescription(strings.commands.attendance.args.first.desc)
				.setRequired(true)
				.setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();
		const results = searchPlayerNames(focusedValue);
		const choices = results.map(row => ({ name: row.player_name, value: row.player_name }));
		await interaction.respond(choices);
	},

	async execute(interaction) {
		await interaction.deferReply();

		const targetPlayer = interaction.options.getString(strings.commands.attendance.args.first.name);

		let attendanceData = [];
		let allOps = [];
		let playerOps = [];
		let globalMonthStats = [];

		try {
			attendanceData = getPlayerAttendanceDetails(targetPlayer);
			allOps = getAllOperationsChronological();
			playerOps = getPlayerOperationsChronological(targetPlayer);
			globalMonthStats = getUnitOperationsPerMonth();
		} catch (error) {
			console.error(error);
			return interaction.editReply(strings.errors.dbFetchFail);
		}

		if (attendanceData.length === 0) {
			return interaction.editReply(strings.errors.noRecords(targetPlayer));
		}

		// --- 1. STREAK CALCULATION ---
		const playerOpSet = new Set(playerOps.map(op => `${op.operation_date}|${op.operation_type}`));
		let currentStreak = 0;
		const streakDetails = [];

		for (const op of allOps) {
			const opKey = `${op.operation_date}|${op.operation_type}`;
			if (playerOpSet.has(opKey)) {
				currentStreak++;
				streakDetails.push(`• \`${op.operation_date}\` - ${op.operation_type}`);
			} else {
				break;
			}
		}

		let streakText = strings.ui.streak.none;
		if (currentStreak > 0) {
			const DISPLAY_LIMIT = 10;
			streakText = streakDetails.slice(0, DISPLAY_LIMIT).join('\n');
			if (currentStreak > DISPLAY_LIMIT) {
				streakText += strings.ui.streak.hiddenCount(currentStreak - DISPLAY_LIMIT);
			}
		}

		// --- 2. FAST LOOKUP FOR GLOBAL MONTHS ---
		// Converts the SQL array into a quick dictionary: { "2026-02": 15, "2026-01": 12 }
		const globalOpsMap = {};
		for (const row of globalMonthStats) {
			globalOpsMap[`${row.year}-${row.month}`] = row.total_ops;
		}

		// --- 3. DATA GROUPING (Yearly Breakdown) ---
		const yearlyStats = {};
		let grandTotal = 0;

		for (const row of attendanceData) {
			if (!yearlyStats[row.year]) yearlyStats[row.year] = { total: 0, months: [] };
			yearlyStats[row.year].total += row.op_count;
			yearlyStats[row.year].months.push({ month: row.month, count: row.op_count });
			grandTotal += row.op_count;
		}

		// --- 4. EMBED BUILDING ---
		const embed = new EmbedBuilder()
			.setTitle(`📅 Attendance Dossier: ${targetPlayer}`)
			.setColor(0x00AAFF)
			.setDescription(`**Lifetime Deployments:** ${grandTotal}`)
			.addFields({
				name: strings.ui.streak.title(currentStreak),
				value: streakText,
				inline: false,
			});

		for (const year in yearlyStats) {
			let monthString = "";
			for (const m of yearlyStats[year].months) {
				const monthName = new Date(parseInt(year), parseInt(m.month) - 1).toLocaleString('en-US', { month: 'long' });

				// Grab the unit's total operations for this specific month from our map
				const globalTotal = globalOpsMap[`${year}-${m.month}`] || m.count;

				// Calculate the percentage
				const percent = Math.round((m.count / globalTotal) * 100);

				// Drop it into your new DRY string!
				monthString += strings.ui.attendanceMonth(monthName, m.count, globalTotal, percent) + '\n';
			}
			embed.addFields({ name: `🏆 ${year} (Total: ${yearlyStats[year].total})`, value: monthString, inline: true });
		}

		return interaction.editReply({ embeds: [embed] });
	},
};