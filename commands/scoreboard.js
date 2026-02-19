const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	StringSelectMenuBuilder,
} = require('discord.js');

const {
	getAggregatedScoreboard,
	getAggregatedScoreboardByDate,
	getPlayerStats,
	searchPlayerNames,
	getFamilyScoreboard,
	getTwinScoreboard,
} = require('../utils/db.js');

const PLAYERS_PER_PAGE = 15;
const strings = require('../utils/strings');

function formatK(num) {
	if (Math.abs(num) >= 1000) {
		return (Math.trunc(num / 100) / 10) + 'k';
	}
	return num.toString();
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.scoreboard.name)
		.setDescription(strings.commands.scoreboard.desc)
		.addStringOption(option =>
			option.setName(strings.commands.scoreboard.args.first.name)
				.setDescription(strings.commands.scoreboard.args.first.desc)
				.setRequired(false)
				.setAutocomplete(true),
		)
		.addStringOption(option =>
			option.setName('view')
				.setDescription('Group the scoreboard by Individuals, Families, or Twins')
				.setRequired(false)
				.addChoices(
					{ name: 'Individual Players', value: 'players' },
					{ name: 'Families (Last Names)', value: 'families' },
					{ name: 'Twins (First Names)', value: 'twins' },
				),
		)
		.addIntegerOption(option =>
			option.setName('month')
				.setDescription('Filter by a specific month')
				.setRequired(false)
				.addChoices(
					{ name: 'January', value: 1 }, { name: 'February', value: 2 }, { name: 'March', value: 3 },
					{ name: 'April', value: 4 }, { name: 'May', value: 5 }, { name: 'June', value: 6 },
					{ name: 'July', value: 7 }, { name: 'August', value: 8 }, { name: 'September', value: 9 },
					{ name: 'October', value: 10 }, { name: 'November', value: 11 }, { name: 'December', value: 12 },
				),
		)
		.addIntegerOption(option =>
			option.setName('year')
				.setDescription('Filter by a specific year (e.g., 2024)')
				.setRequired(false),
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
		await interaction.deferReply();

		const targetPlayer = interaction.options.getString('player');
		const viewMode = interaction.options.getString('view') || 'players';
		const targetMonth = interaction.options.getInteger('month');
		const targetYear = interaction.options.getInteger('year');

		if (targetPlayer) {
			const now = new Date();
			const displayYear = now.getFullYear();
			const displayMonth = now.toLocaleString('en-US', { month: 'long' });
			const currentYearPrefix = String(now.getFullYear());
			const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

			let playerData;
			try {
				playerData = getPlayerStats(targetPlayer, currentMonthPrefix, currentYearPrefix);
			} catch (error) {
				console.error(error);
				return interaction.editReply(strings.errors.genericError({ message: 'Failed to fetch player data from the database.' }));
			}

			if (!playerData) {
				return interaction.editReply(strings.errors.genericError({ message: `Could not find any stats for a player matching "**${targetPlayer}**".` }));
			}

			const playerEmbed = new EmbedBuilder()
				.setTitle(`👤 Service Record: ${playerData.name}`)
				.setColor(0xFFD700)
				.setDescription(
					`**Total Operations:** ${playerData.operations_attended}\n` +
					`** └ ${displayYear}:** ${playerData.operations_this_year}\n` +
					`** └ ${displayMonth}:** ${playerData.operations_this_month}\n`,
				)
				.addFields(
					{ name: strings.stats.infantry, value: `${formatK(playerData.inf_kills)}`, inline: true },
					{ name: strings.stats.softVeh, value: `${formatK(playerData.soft_veh)}`, inline: true },
					{ name: strings.stats.armorVeh, value: `${formatK(playerData.armor_veh)}`, inline: true },
					{ name: strings.stats.air, value: `${formatK(playerData.air)}`, inline: true },
					{ name: strings.stats.deaths, value: `${formatK(playerData.deaths)}`, inline: true },
					{ name: strings.stats.score, value: `${formatK(playerData.score)}`, inline: true },
				)
				.setTimestamp();

			return interaction.editReply({ embeds: [playerEmbed] });
		}

		let datePrefix = null;
		let timeframeTitle = 'All-Time';

		if (targetMonth || targetYear) {
			const yearToUse = targetYear || new Date().getFullYear();

			if (targetMonth) {
				datePrefix = `${yearToUse}-${String(targetMonth).padStart(2, '0')}`;
				const monthName = new Date(yearToUse, targetMonth - 1).toLocaleString('en-US', { month: 'long' });
				timeframeTitle = `${monthName} ${yearToUse}`;
			} else {
				datePrefix = `${yearToUse}`;
				timeframeTitle = `${yearToUse} Yearly`;
			}
		}

		let rawData = [];
		try {
			if (viewMode === 'families') {
				rawData = getFamilyScoreboard(datePrefix);
			} else if (viewMode === 'twins') {
				rawData = getTwinScoreboard(datePrefix);
			} else {
				rawData = datePrefix ? getAggregatedScoreboardByDate(datePrefix) : getAggregatedScoreboard();
			}
		} catch (error) {
			console.error(error);
			return interaction.editReply(strings.errors.genericError({ message: 'Failed to fetch data from the database.' }));
		}

		if (rawData.length === 0) {
			let errorMsg;
			if (viewMode === 'families') {
				errorMsg = `📭 No families found for the **${timeframeTitle}** timeframe. (A family requires at least 2 players with the same last name).`;
			} else if (viewMode === 'twins') {
				errorMsg = `📭 No twins found for the **${timeframeTitle}** timeframe. (A twin group requires at least 2 players with the same first name).`;
			} else {
				errorMsg = `📭 No operations or players found for the **${timeframeTitle}** timeframe.`;
			}
			return interaction.editReply({ content: errorMsg });
		}

		let currentPage = 0;
		let currentSort = 'score';

		const generateEmbed = (page, sortType) => {
			const sortedData = [...rawData].sort((a, b) => b[sortType] - a[sortType]);
			const totalPages = Math.ceil(sortedData.length / PLAYERS_PER_PAGE);
			const startIndex = page * PLAYERS_PER_PAGE;
			const pageData = sortedData.slice(startIndex, startIndex + PLAYERS_PER_PAGE);

			let tableStr = "```ansi\n";

			pageData.forEach((item, index) => {
				const overallRank = startIndex + index + 1;

				let rankStr = `#${overallRank}. `.padStart(3, ' ');
				if (overallRank === 1) rankStr = "🥇 ";
				if (overallRank === 2) rankStr = "🥈 ";
				if (overallRank === 3) rankStr = "🥉 ";

				// Dynamically display the name based on the view
				let displayName = item.name;
				if (viewMode === 'families') {
					displayName = `The ${item.name} Family (${item.members} members)`;
				} else if (viewMode === 'twins') {
					displayName = `The ${item.name} Twins (${item.members} members)`;
				}

				const fInf = formatK(item.inf_kills);
				const fSoft = formatK(item.soft_veh);
				const fArmor = formatK(item.armor_veh);
				const fAir = formatK(item.air);
				const fDeaths = formatK(item.deaths);
				const fScore = formatK(item.score);
				const fOps = formatK(item.ops_attended);

				const stats = `🪖 ${fInf} 🚗 ${fSoft} 🚚 ${fArmor} ✈️ ${fAir} 💀 ${fDeaths} ∑ ${fScore} 🗺️ ${fOps}`;

				if (overallRank <= 3) {
					tableStr += `\u001b[1m${rankStr}${displayName}\u001b[0m\n└ ${stats}\n`;
				} else {
					tableStr += `${rankStr}${displayName}\n└ ${stats}\n`;
				}
			});
			tableStr += "```";

			// Set up dynamic UI variables
			let embedTitle = '📊 Unit Scoreboard';
			let embedColor = 0x00AAFF;
			let entityName = 'Players';

			if (viewMode === 'families') {
				embedTitle = '🛡️ Family Scoreboard';
				embedColor = 0x8B0000;
				entityName = 'Families';
			} else if (viewMode === 'twins') {
				embedTitle = '👯 Twin Scoreboard';
				embedColor = 0x8A2BE2;
				entityName = 'Twin Groups';
			}

			const sortDisplayName = strings.ui.sortNames[sortType] || (sortType === 'ops_attended' ? 'Operations Attended' : sortType);

			return new EmbedBuilder()
				.setTitle(`${embedTitle} (${timeframeTitle}) | Sorted by: ${sortDisplayName}`)
				.setColor(embedColor)
				.setDescription(tableStr)
				.setFooter({
					text: `Page ${page + 1} of ${totalPages || 1} | Total Tracked ${entityName}: ${sortedData.length}\n🪖: Infantry | 🚗: Soft Veh. | 🚚: Armoured Veh. | ✈️: Air | 💀: Deaths | ∑: Score | 🗺️: Ops Attended`,
				});
		};

		const generateComponents = (page, sortType) => {
			const totalPages = Math.ceil(rawData.length / PLAYERS_PER_PAGE);

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId('sort_select')
				.setPlaceholder('Sort leaderboard by...')
				.addOptions([
					{ label: 'Operations Attended', value: 'ops_attended', default: sortType === 'ops_attended' },
					{ label: strings.ui.sortNames.inf_kills, value: 'inf_kills', default: sortType === 'inf_kills' },
					{ label: strings.ui.sortNames.soft_veh, value: 'soft_veh', default: sortType === 'soft_veh' },
					{ label: strings.ui.sortNames.armor_veh, value: 'armor_veh', default: sortType === 'armor_veh' },
					{ label: strings.ui.sortNames.air, value: 'air', default: sortType === 'air' },
					{ label: strings.ui.sortNames.deaths, value: 'deaths', default: sortType === 'deaths' },
					{ label: strings.ui.sortNames.score, value: 'score', default: sortType === 'score' },
				]);

			const prevButton = new ButtonBuilder()
				.setCustomId('prev_page')
				.setLabel(strings.ui.prevBtn)
				.setStyle(ButtonStyle.Primary)
				.setDisabled(page === 0);

			const nextButton = new ButtonBuilder()
				.setCustomId('next_page')
				.setLabel(strings.ui.nextBtn)
				.setStyle(ButtonStyle.Primary)
				.setDisabled(page >= totalPages - 1 || totalPages === 0);

			const row1 = new ActionRowBuilder().addComponents(selectMenu);
			const row2 = new ActionRowBuilder().addComponents(prevButton, nextButton);

			return [row1, row2];
		};

		const response = await interaction.editReply({
			embeds: [generateEmbed(currentPage, currentSort)],
			components: generateComponents(currentPage, currentSort),
		});

		const collector = response.createMessageComponentCollector({
			time: 300_000,
		});

		collector.on('collect', async i => {
			if (i.user.id !== interaction.user.id) {
				return i.reply({ content: strings.errors.notYourMenu, ephemeral: true });
			}

			if (i.isStringSelectMenu() && i.customId === 'sort_select') {
				currentSort = i.values[0];
				currentPage = 0;
			}

			if (i.isButton()) {
				if (i.customId === 'prev_page') currentPage--;
				if (i.customId === 'next_page') currentPage++;
			}

			try {
				await i.update({
					embeds: [generateEmbed(currentPage, currentSort)],
					components: generateComponents(currentPage, currentSort),
				});
			} catch (error) {
				if (error.code === 10062) {
					console.warn(`[Network] Ignored expired interaction from ${i.user.tag}`);
				} else {
					console.error(error);
				}
			}
		});

		collector.on('end', () => {
			interaction.editReply({ components: [] }).catch(console.error);
		});
	},
};