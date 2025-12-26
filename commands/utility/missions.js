const {
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const TARGET_DIR = 'C:\\Games\\ArmaA3\\mpmissions';
const ITEMS_PER_PAGE = 10;

module.exports = {
	data: new SlashCommandBuilder()
		.setName('missions')
		.setDescription('Lists all .pbo mission files on the server (Newest first)'),

	async execute(interaction) {
		await interaction.deferReply();

		// 1. Read and Sort Files
		let files = [];
		try {
			const fileNames = fs.readdirSync(TARGET_DIR);

			// Map names to objects with stats
			const fileStats = fileNames
				.filter(name => name.toLowerCase().endsWith('.pbo'))
				.map(name => {
					const filePath = path.join(TARGET_DIR, name);
					const stats = fs.statSync(filePath);
					return {
						name: name,
						mtime: stats.mtime,
					};
				});

			// Sort by Date (Newest First)
			files = fileStats.sort((a, b) => b.mtime - a.mtime);

		} catch (error) {
			console.error(error);
			return interaction.editReply('❌ Could not read the missions directory.');
		}

		if (files.length === 0) {
			return interaction.editReply('📂 No mission files found.');
		}

		// 2. Pagination Logic
		const totalPages = Math.ceil(files.length / ITEMS_PER_PAGE);
		let currentPage = 0;

		// Helper: Generates the Embed for a specific page
		const generateEmbed = (page) => {
			const start = page * ITEMS_PER_PAGE;
			const end = start + ITEMS_PER_PAGE;
			const currentFiles = files.slice(start, end);

			const embed = new EmbedBuilder()
				.setTitle(`📂 Mission Files (${files.length} Total)`)
				.setColor(0x0099FF)
				.setFooter({ text: `Page ${page + 1} of ${totalPages}` })
				.setTimestamp();

			// Format the list
			const description = currentFiles.map(f => {
				const dateStr = f.mtime.toLocaleString('en-GB', {
					day: '2-digit', month: '2-digit', year: 'numeric',
					hour: '2-digit', minute: '2-digit',
				});

				// 1. CLEAN THE NAME: Decode %20 back to spaces
				let parsedName = f.name;
				try {
					parsedName = decodeURIComponent(f.name);
				} catch (e) {
					console.error("Error decoding filename:", e);
				}

				// 2. FORMAT: The 3-line structure you asked for
				// We wrap the raw filename in `code blocks` so it's distinct
				return `**${parsedName}**\n└ \`${f.name}\`\n└ ${dateStr}`;
			}).join('\n\n');

			embed.setDescription(description);
			return embed;
		};

		// Helper: Generates the Buttons (Disabling them if at start/end)
		const generateButtons = (page) => {
			const row = new ActionRowBuilder();

			const prevBtn = new ButtonBuilder()
				.setCustomId('prev')
				.setLabel('◀ Previous')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(page === 0);

			const nextBtn = new ButtonBuilder()
				.setCustomId('next')
				.setLabel('Next ▶')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(page === totalPages - 1);

			row.addComponents(prevBtn, nextBtn);
			return row;
		};

		// 3. Send Initial Message
		const response = await interaction.editReply({
			embeds: [generateEmbed(currentPage)],
			components: totalPages > 1 ? [generateButtons(currentPage)] : [],
		});

		// If only 1 page, we don't need buttons or a collector
		if (totalPages <= 1) return;

		// 4. Handle Button Clicks
		const collector = response.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60000,
		});

		collector.on('collect', async i => {
			// Check if the user clicking is the one who ran the command
			if (i.user.id !== interaction.user.id) {
				return i.reply({ content: '❌ You cannot control this menu.', ephemeral: true });
			}

			if (i.customId === 'prev') {
				if (currentPage > 0) currentPage--;
			} else if (i.customId === 'next') {
				if (currentPage < totalPages - 1) currentPage++;
			}

			await i.update({
				embeds: [generateEmbed(currentPage)],
				components: [generateButtons(currentPage)],
			});
		});

		collector.on('end', () => {
			// Optional: Remove buttons when time expires so people don't click dead buttons
			interaction.editReply({ components: [] }).catch(() => { console.error('Error removing buttons'); });
		});
	},
};