const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getAllPlayerNames } = require('../utils/db');
const strings = require('../utils/strings');

const NAMES_PER_PAGE = 30;

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.players.name)
		.setDescription(strings.commands.players.desc),

	async execute(interaction) {
		await interaction.deferReply({ ephemeral: true });

		const allPlayers = getAllPlayerNames();

		if (allPlayers.length === 0) {
			return interaction.editReply(strings.errors.noRecords('player'));
		}

		let currentPage = 0;
		const totalPages = Math.ceil(allPlayers.length / NAMES_PER_PAGE);

		const generateEmbed = (page) => {
			const startIndex = page * NAMES_PER_PAGE;
			const pageData = allPlayers.slice(startIndex, startIndex + NAMES_PER_PAGE);

			// Create a neat bulleted list of names
			const nameList = pageData.map(p => `• ${p.player_name}`).join('\n');

			return new EmbedBuilder()
				.setTitle(`📋 Registered Personnel Database`)
				.setColor(0x00FF00)
				.setDescription(`Found **${allPlayers.length}** unique players.\n\n${nameList}`)
				.setFooter({ text: `Page ${page + 1} of ${totalPages}` });
		};

		const generateButtons = (page) => {
			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId('prev_page')
					.setLabel(strings.ui.prevBtn)
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page === 0),
				new ButtonBuilder()
					.setCustomId('next_page')
					.setLabel(strings.ui.nextBtn)
					.setStyle(ButtonStyle.Primary)
					.setDisabled(page === totalPages - 1 || totalPages === 0),
			);
			return [row];
		};

		const responseMessage = await interaction.editReply({
			embeds: [generateEmbed(currentPage)],
			components: totalPages > 1 ? generateButtons(currentPage) : [],
		});

		// Setup Collector for Pagination
		if (totalPages > 1) {
			const collector = responseMessage.createMessageComponentCollector({ time: 300_000 });

			collector.on('collect', async i => {
				if (i.user.id !== interaction.user.id) return i.reply({ content: '🚫 Not your menu.', ephemeral: true });

				if (i.customId === 'prev_page') currentPage--;
				if (i.customId === 'next_page') currentPage++;

				try {
					await i.update({
						embeds: [generateEmbed(currentPage)],
						components: generateButtons(currentPage),
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
				interaction.editReply({ components: [] }).catch(console.warning);
			});
		}
	},
};