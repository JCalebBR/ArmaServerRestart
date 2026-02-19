const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require('discord.js');

// Import our new database function
const { getOperationsByDateRange } = require('../utils/db');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('operationmonth')
		.setDescription('List past operations within a specific timeframe')
		.addStringOption(option =>
			option.setName('start_date')
				.setDescription('Start date (YYYY-MM-DD) - Inclusive')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('end_date')
				.setDescription('End date (YYYY-MM-DD) - Inclusive')
				.setRequired(true)),

	async execute(interaction) {
		const startDateStr = interaction.options.getString('start_date');
		const endDateStr = interaction.options.getString('end_date');

		// 1. Basic Date Validation
		const startDate = new Date(startDateStr);
		const endDate = new Date(endDateStr);

		if (isNaN(startDate) || isNaN(endDate)) {
			return interaction.reply({
				content: '❌ Invalid date format. Please use YYYY-MM-DD.',
				ephemeral: true,
			});
		}

		if (startDate > endDate) {
			return interaction.reply({
				content: '❌ The start date cannot be after the end date.',
				ephemeral: true,
			});
		}

		// --- REAL DATABASE QUERY ---
		// This hits the SQLite database and returns the grouped operations
		const allOperations = getOperationsByDateRange(startDateStr, endDateStr);

		// 2. Pagination State
		const ITEMS_PER_PAGE = 5;
		const maxPages = Math.ceil(allOperations.length / ITEMS_PER_PAGE);
		let currentPage = 0;

		// 3. Helper: Generate the Embed for the current page
		const generateEmbed = (page) => {
			const startIdx = page * ITEMS_PER_PAGE;
			const currentItems = allOperations.slice(startIdx, startIdx + ITEMS_PER_PAGE);

			const embed = new EmbedBuilder()
				.setTitle(`📅 Operations: ${startDateStr} to ${endDateStr}`)
				.setColor(0x0099FF)
				.setFooter({ text: `Page ${page + 1} of ${maxPages || 1} • Total Operations: ${allOperations.length}` });

			if (currentItems.length === 0) {
				embed.setDescription('*No operations found in this timeframe.*');
			} else {
				currentItems.forEach(op => {
					embed.addFields({
						// Using operation_date and operation_type from the DB
						name: `${op.operation_date} - ${op.operation_type}`,
						value: `👥 Attendees: ${op.players}`,
						inline: false,
					});
				});
			}

			return embed;
		};

		// 4. Helper: Generate Buttons for the current page
		const generateButtons = (page) => {
			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId('prev_page')
					.setLabel('Previous')
					.setEmoji('◀️')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page === 0),
				new ButtonBuilder()
					.setCustomId('next_page')
					.setLabel('Next')
					.setEmoji('▶️')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page >= maxPages - 1 || maxPages === 0),
			);
			return row;
		};

		// 5. Send Initial Response
		const initialEmbed = generateEmbed(currentPage);
		const initialButtons = generateButtons(currentPage);

		const response = await interaction.reply({
			embeds: [initialEmbed],
			components: maxPages > 1 ? [initialButtons] : [],
			fetchReply: true,
		});

		if (maxPages <= 1) return;

		// 6. Setup the Component Collector
		const collector = response.createMessageComponentCollector({
			componentType: ComponentType.Button,
			idle: 60_000,
		});

		collector.on('collect', async i => {
			// Security: Ensure only the person who ran the command can flip the pages
			if (i.user.id !== interaction.user.id) {
				return i.reply({ content: '🚫 You cannot use these buttons.', ephemeral: true });
			}

			// Update page index
			if (i.customId === 'prev_page') {
				currentPage--;
			} else if (i.customId === 'next_page') {
				currentPage++;
			}

			// Acknowledge and update UI
			await i.update({
				embeds: [generateEmbed(currentPage)],
				components: [generateButtons(currentPage)],
			});
		});

		// 7. Cleanup when the collector times out
		collector.on('end', () => {
			const disabledButtons = new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId('prev_page').setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(true),
				new ButtonBuilder().setCustomId('next_page').setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(true),
			);

			interaction.editReply({ components: [disabledButtons] }).catch(() => { console.warn('Error removing buttons'); });
		});
	},
};