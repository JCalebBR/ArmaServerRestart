const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getMinecraftEntry } = require('../utils/config');
const { sendPaginated } = require('../utils/discordPagination');
const { getLink } = require('../utils/minecraftState');
const { listKnownPlayers, readPlayerStats } = require('../utils/minecraftStats');
const strings = require('../utils/strings');

async function linkedNickname(interaction, link) {
	if (!link?.discord_user_id || !interaction.guild) return 'Not linked';
	try {
		const member = await interaction.guild.members.fetch(link.discord_user_id);
		return member.nickname || 'No server nickname set';
	} catch {
		return 'Member unavailable';
	}
}

function buildStatsEmbeds(player, nickname) {
	const summary = player.summary;
	const embeds = [new EmbedBuilder()
		.setColor(0x27AE60)
		.setTitle(`⛏️ Minecraft Stats — ${player.name}`)
		.setDescription(`Discord nickname: **${nickname}**\nUUID: \`${player.uuid}\``)
		.addFields(
			{ name: 'Play time', value: summary.playTime, inline: true },
			{ name: 'Deaths', value: summary.deaths.toLocaleString(), inline: true },
			{ name: 'Player kills', value: summary.playerKills.toLocaleString(), inline: true },
			{ name: 'Mob kills', value: summary.mobKills.toLocaleString(), inline: true },
			{ name: 'Blocks mined', value: summary.blocksMined.toLocaleString(), inline: true },
			{ name: 'Items crafted', value: summary.itemsCrafted.toLocaleString(), inline: true },
			{ name: 'Items used', value: summary.itemsUsed.toLocaleString(), inline: true },
			{ name: 'Distance', value: `${summary.distanceKm.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`, inline: true },
			{ name: 'Damage dealt / taken', value: `${summary.damageDealt.toLocaleString()} / ${summary.damageTaken.toLocaleString()}`, inline: true },
		)
		.setTimestamp(player.modifiedAt)];

	for (const [category, entries] of Object.entries(player.categories)) {
		const description = entries.length > 0
			? entries.map((entry, index) => `${index + 1}. **${entry.label}** — ${entry.count.toLocaleString()}`).join('\n')
			: 'No recorded entries.';
		embeds.push(new EmbedBuilder()
			.setColor(0x5865F2)
			.setTitle(`${category} — ${player.name}`)
			.setDescription(description)
			.setTimestamp(player.modifiedAt));
	}
	return embeds.map((embed, index) => embed.setFooter({ text: `Page ${index + 1} of ${embeds.length} • Last persisted snapshot` }));
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.mcstats.name)
		.setDescription(strings.commands.mcstats.desc)
		.addStringOption(option => option
			.setName('player')
			.setDescription('Minecraft player')
			.setRequired(true)
			.setAutocomplete(true)),

	async autocomplete(interaction) {
		try {
			const { config } = getMinecraftEntry();
			const focused = interaction.options.getFocused().toLowerCase();
			const names = listKnownPlayers(config).filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
			await interaction.respond(names.map(name => ({ name, value: name })));
		} catch {
			await interaction.respond([]);
		}
	},

	async execute(interaction) {
		await interaction.deferReply();
		try {
			const { config } = getMinecraftEntry();
			const player = readPlayerStats(config, interaction.options.getString('player', true));
			const link = player.link || getLink(player.uuid) || getLink(player.name);
			const nickname = await linkedNickname(interaction, link);
			return sendPaginated(interaction, buildStatsEmbeds(player, nickname), {
				editReply: true,
				prefix: `mcstats_${interaction.id}`,
			});
		} catch (error) {
			return interaction.editReply(`❌ ${error.message}`);
		}
	},

	_buildStatsEmbeds: buildStatsEmbeds,
};
