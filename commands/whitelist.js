const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getMinecraftEntry } = require('../utils/config');
const { sendPaginated, paginateLines } = require('../utils/discordPagination');
const { RconUnavailableError } = require('../utils/minecraftRcon');
const strings = require('../utils/strings');
const {
	applyWhitelistOperation,
	clearQueuedOperation,
	getLinks,
	getQueue,
	normalizeMinecraftName,
	queueWhitelistOperation,
	readWhitelist,
} = require('../utils/minecraftState');

function nicknameFor(member) {
	if (!member) return 'Member unavailable';
	return member.nickname || 'No server nickname set';
}

async function fetchMember(guild, userId) {
	if (!guild || !userId) return null;
	try {
		return await guild.members.fetch(userId);
	} catch {
		return null;
	}
}

function loadMinecraft() {
	return getMinecraftEntry();
}

async function executeWrite(interaction, action) {
	await interaction.deferReply();
	let entry;
	try {
		entry = loadMinecraft();
	} catch (error) {
		return interaction.editReply(`❌ ${error.message}`);
	}

	let minecraftName;
	try { minecraftName = normalizeMinecraftName(interaction.options.getString('minecraft_username', true)); }
	catch (error) { return interaction.editReply(`❌ ${error.message}`); }

	let discordUser = null;
	let member = null;
	if (action === 'add') {
		discordUser = interaction.options.getUser('discord_member', true);
		member = await fetchMember(interaction.guild, discordUser.id);
	}
	const operation = {
		minecraftName,
		action,
		discordUserId: discordUser?.id || null,
		lastNickname: nicknameFor(member),
	};
	try {
		queueWhitelistOperation({
			...operation,
			requesterUserId: interaction.user.id,
			guildId: interaction.guildId,
		});
	} catch (error) {
		console.error('[Minecraft Whitelist] Could not persist operation:', error);
		return interaction.editReply(`❌ Could not persist the whitelist request: ${error.message}`);
	}

	try {
		await applyWhitelistOperation(entry.config, operation);
		clearQueuedOperation(minecraftName);
		const embed = new EmbedBuilder()
			.setColor(action === 'add' ? 0x27AE60 : 0xF2994A)
			.setTitle(action === 'add' ? '✅ Minecraft Whitelist Updated' : '✅ Minecraft Whitelist Entry Removed')
			.addFields({ name: 'Minecraft', value: `\`${minecraftName}\``, inline: true })
			.setTimestamp();
		if (action === 'add') {
			embed.addFields(
				{ name: 'Discord member', value: `<@${discordUser.id}>`, inline: true },
				{ name: 'Discord nickname', value: nicknameFor(member), inline: true },
			);
		}
		return interaction.editReply({ embeds: [embed], allowedMentions: { users: [] } });
	} catch (error) {
		if (!(error instanceof RconUnavailableError)) {
			clearQueuedOperation(minecraftName);
			console.error('[Minecraft Whitelist] Operation failed:', error);
			return interaction.editReply(`❌ Could not ${action} **${minecraftName}**: ${error.message}`);
		}

		const embed = new EmbedBuilder()
			.setColor(0xF2C94C)
			.setTitle('⏳ Minecraft Whitelist Change Queued')
			.setDescription(`Minecraft is unavailable. The **${action}** request will be applied automatically when RCON returns.`)
			.addFields({ name: 'Minecraft', value: `\`${minecraftName}\``, inline: true })
			.setTimestamp();
		if (action === 'add') embed.addFields({ name: 'Discord nickname', value: nicknameFor(member), inline: true });
		return interaction.editReply({ embeds: [embed] });
	}
}

async function executeList(interaction) {
	await interaction.deferReply();
	let entry;
	try {
		entry = loadMinecraft();
	} catch (error) {
		return interaction.editReply(`❌ ${error.message}`);
	}

	let whitelist;
	try { whitelist = readWhitelist(entry.config); }
	catch (error) { return interaction.editReply(`❌ Could not read whitelist.json: ${error.message}`); }
	const links = getLinks();
	const queue = getQueue();
	const linksByIdentity = new Map();
	for (const link of links) {
		linksByIdentity.set(link.minecraft_name.toLowerCase(), link);
		if (link.minecraft_uuid) linksByIdentity.set(link.minecraft_uuid.toLowerCase(), link);
	}

	const userIds = [...new Set(links.map(link => link.discord_user_id).filter(Boolean))];
	const members = new Map(await Promise.all(userIds.map(async id => [id, await fetchMember(interaction.guild, id)])));
	const lines = whitelist.map(item => {
		const link = linksByIdentity.get(item.uuid?.toLowerCase()) || linksByIdentity.get(item.name.toLowerCase());
		const nickname = link ? nicknameFor(members.get(link.discord_user_id)) : 'Not linked';
		const discord = link ? ` • <@${link.discord_user_id}>` : '';
		return `• **${item.name}** — ${nickname}${discord}`;
	});
	if (queue.length > 0) {
		lines.push('', '**Pending changes**');
		for (const item of queue) {
			const nickname = item.action === 'add' ? ` — ${item.last_nickname || 'No server nickname set'}` : '';
			lines.push(`• ${item.action === 'add' ? '➕' : '➖'} **${item.minecraft_name}**${nickname}`);
		}
	}
	if (lines.length === 0) lines.push('No players are currently whitelisted or queued.');

	const pages = paginateLines(lines).map((description, index, all) => new EmbedBuilder()
		.setColor(0x5865F2)
		.setTitle(`📋 Minecraft Whitelist — ${whitelist.length} Applied`)
		.setDescription(description)
		.setFooter({ text: `Page ${index + 1} of ${all.length} • ${queue.length} pending` })
		.setTimestamp());
	return sendPaginated(interaction, pages, {
		editReply: true,
		prefix: `whitelist_${interaction.id}`,
		allowedMentions: { parse: [] },
	});
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.whitelist.name)
		.setDescription(strings.commands.whitelist.desc)
		.addSubcommand(command => command
			.setName('add')
			.setDescription('Add or link a Minecraft player')
			.addStringOption(option => option.setName('minecraft_username').setDescription('Java Edition username').setRequired(true))
			.addUserOption(option => option.setName('discord_member').setDescription('Discord member to associate').setRequired(true)))
		.addSubcommand(command => command
			.setName('remove')
			.setDescription('Remove a Minecraft player')
			.addStringOption(option => option.setName('minecraft_username').setDescription('Java Edition username').setRequired(true)))
		.addSubcommand(command => command.setName('list').setDescription('List applied and queued whitelist entries')),

	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		if (subcommand === 'list') return executeList(interaction);
		return executeWrite(interaction, subcommand);
	},

	_executeList: executeList,
	_executeWrite: executeWrite,
	_nicknameFor: nicknameFor,
};
