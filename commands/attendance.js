const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const {
	searchPlayerNames,
	getPlayerAttendanceDetails,
	getAllOperationsChronological,
	getPlayerOperationsChronological,
	getUnitOperationsPerMonth,
	getMonthlyAttendanceAllPlayers,
} = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.attendance.name)
		.setDescription(strings.commands.attendance.desc)
		.addStringOption(option =>
			option.setName(strings.commands.attendance.args.first.name)
				.setDescription(strings.commands.attendance.args.first.desc)
				.setRequired(false)
				.setAutocomplete(true),
		)
		.addStringOption(option =>
			option.setName('month')
				.setDescription('Generate a unit-wide inactivity report for a specific month in the current year')
				.setRequired(false)
				.addChoices(
					{ name: 'January', value: '01' }, { name: 'February', value: '02' },
					{ name: 'March', value: '03' }, { name: 'April', value: '04' },
					{ name: 'May', value: '05' }, { name: 'June', value: '06' },
					{ name: 'July', value: '07' }, { name: 'August', value: '08' },
					{ name: 'September', value: '09' }, { name: 'October', value: '10' },
					{ name: 'November', value: '11' }, { name: 'December', value: '12' },
				),
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
		const reportMonth = interaction.options.getString('month');

		// ==========================================
		// WORKFLOW 1: UNIT-WIDE INACTIVITY REPORT
		// ==========================================
		if (reportMonth) {
			const currentYear = new Date().getFullYear().toString();

			// 1. Fetch Discord Members and DB Stats
			let members;
			try {
				await interaction.guild.members.fetch();
				members = interaction.guild.members.cache.values();
			} catch (err) {
				return interaction.editReply('❌ Failed to fetch Discord server members.');
			}

			const rawDbData = getMonthlyAttendanceAllPlayers(currentYear, reportMonth);

			const dbOpsMap = {};
			for (const row of rawDbData) {
				dbOpsMap[row.player_name.toLowerCase()] = row.op_count;
			}

			// Define Role Categories (Ordered highest to lowest prestige so the highest title applies)
			const tier3RolesOrdered = [
				'castellan', 'marshall', "emperor's champion", 'reclusiarch', 'reverend chaplain',
				'apothecary lord', 'forge master', 'squad leader', 'sword brother',
				'apothecary consiliarius', 'forge initiate', 'reclusiam', 'armoury', 'apothecarion',
			];

			// The 'data' objects will hold grouped arrays: { "Squad Leader": [player1, player2], "Armoury": [player3] }
			const report = {
				command: { title: "Command & Specialists", req: 3, color: 0xFFD700, data: {} },
				fighting: { title: "Fighting Company", req: 2, color: 0xAA0000, data: {} },
				reserves: { title: "Reserves", req: 1, color: 0x555555, data: {} },
			};

			// 2. Process Members
			for (const member of members) {
				if (member.user.bot) continue;

				const roleNames = member.roles.cache.map(r => r.name.toLowerCase());

				// --- NEW: Filter out Retired and Visitor roles immediately ---
				if (roleNames.includes('retired bt') || roleNames.includes('visitor')) {
					continue;
				}
				// -------------------------------------------------------------

				let category = null;
				let displayRole = null;

				// Priority 1: Reserves strictly overrides everything else
				if (roleNames.includes('reserves')) {
					category = 'reserves';
					displayRole = member.roles.cache.find(r => r.name.toLowerCase() === 'reserves').name;
				}
				// Priority 2: Command & Specialists (Finds the highest matching role based on our ordered array)
				else {
					const highestT3 = tier3RolesOrdered.find(r => roleNames.includes(r));
					if (highestT3) {
						category = 'command';
						displayRole = member.roles.cache.find(r => r.name.toLowerCase() === highestT3).name;
					}
					// Priority 3: Fighting Company
					else if (roleNames.includes('fighting company orosius')) {
						category = 'fighting';
						displayRole = member.roles.cache.find(r => r.name.toLowerCase() === 'fighting company orosius').name;
					}
				}

				// Skip users who don't have any of the tracked roles
				if (!category) continue;

				const rawDiscordName = member.nickname || member.displayName || member.user.username;
				const cleanDiscordName = rawDiscordName
					.replace(/\s*\([^)]*\)/g, '')
					.replace(/[^\w\s']/g, '')
					.replace(/\bBT\b/g, '')
					.trim()
					.replace(/\s+/g, ' ');

				// Look up their attendance, defaulting to 0 if they didn't deploy
				const ops = dbOpsMap[cleanDiscordName.toLowerCase()] || 0;

				// ONLY add them to the report if they FAILED to meet the requirement
				if (ops < report[category].req) {
					if (!report[category].data[displayRole]) {
						report[category].data[displayRole] = [];
					}
					report[category].data[displayRole].push({ name: cleanDiscordName, ops });
				}
			}

			// 3. Build the Paginated Embeds
			const embeds = [];
			const displayOrder = ['command', 'fighting', 'reserves'];
			const chunkArray = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));

			for (const catKey of displayOrder) {
				const cat = report[catKey];

				const embed = new EmbedBuilder()
					.setTitle(`📊 Inactivity Report: ${cat.title} (${reportMonth}/${currentYear})`)
					.setColor(cat.color)
					.setDescription(`Minimum Requirement: **${cat.req} Operations**\n*Showing only members who failed to meet this requirement.*`);

				// If everyone passed, show a success message!
				if (Object.keys(cat.data).length === 0) {
					embed.addFields({ name: '✅ Status', value: 'All members in this category met their activity requirements!' });
				} else {
					// Group the inactive players by their specific role
					for (const roleName of Object.keys(cat.data).sort()) {
						// Sort names alphabetically
						const inactiveMembers = cat.data[roleName].sort((a, b) => a.name.localeCompare(b.name));
						const lines = inactiveMembers.map(m => `❌ **${m.name}** (${m.ops}/${cat.req})`);

						// Chunk in case a role has a massive amount of inactive players
						const chunks = chunkArray(lines, 12);
						chunks.forEach((chunk, i) => {
							embed.addFields({ name: i === 0 ? `🛡️ ${roleName}` : `🛡️ ${roleName} (Cont.)`, value: chunk.join('\n'), inline: true });
						});
					}
				}
				embeds.push(embed);
			}

			// 4. Interactive Paginator Logic
			let currentPage = 0;

			const getRow = (index) => {
				return new ActionRowBuilder().addComponents(
					new ButtonBuilder().setCustomId('prev').setLabel('◀️ Previous Page').setStyle(ButtonStyle.Primary).setDisabled(index === 0),
					new ButtonBuilder().setCustomId('next').setLabel('Next Page ▶️').setStyle(ButtonStyle.Primary).setDisabled(index === embeds.length - 1),
				);
			};

			const responseMessage = await interaction.editReply({ embeds: [embeds[currentPage]], components: [getRow(currentPage)] });

			const collector = responseMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300_000 });

			collector.on('collect', async i => {
				if (i.user.id !== interaction.user.id) return i.reply({ content: '❌ Only the person who ran the command can use these buttons.', ephemeral: true });

				if (i.customId === 'prev') currentPage--;
				if (i.customId === 'next') currentPage++;

				await i.update({ embeds: [embeds[currentPage]], components: [getRow(currentPage)] });
			});

			collector.on('end', () => {
				// Remove the buttons when the 5 minutes are up so it doesn't clutter the chat
				interaction.editReply({ components: [] }).catch(() => { });
			});

			return;
		}


		// ==========================================
		// WORKFLOW 2: INDIVIDUAL PLAYER DOSSIER
		// ==========================================
		if (!targetPlayer) {
			return interaction.editReply('❌ You must provide either a `name` for a player dossier, OR a `month` for a unit report.');
		}

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

				const globalTotal = globalOpsMap[`${year}-${m.month}`] || m.count;
				const percent = Math.round((m.count / globalTotal) * 100);

				monthString += strings.ui.attendanceMonth(monthName, m.count, globalTotal, percent) + '\n';
			}
			embed.addFields({ name: `🏆 ${year} (Total: ${yearlyStats[year].total})`, value: monthString, inline: true });
		}

		return interaction.editReply({ embeds: [embed] });
	},
};