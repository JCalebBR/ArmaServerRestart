const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GameDig } = require('gamedig');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');
const { isMinecraft, findConfiguredProcesses } = require('../utils/serverLifecycle');
const { sendRcon } = require('../utils/minecraftRcon');

const CONFIG_PATH = path.join(__dirname, '../servers.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.status.name)
		.setDescription(strings.commands.status.desc)
		.addStringOption(option =>
			option.setName(strings.commands.status.args.first.name)
				.setDescription(strings.commands.status.args.first.desc)
				.setRequired(true)
				.setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();
		let config = {};
		try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
		catch (e) {
			console.error("Error reading servers.json", e);
		}

		const choices = config.servers ? Object.keys(config.servers) : [];
		const filtered = choices.filter(choice => choice.toLowerCase().startsWith(focusedValue.toLowerCase())).slice(0, 25);
		await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
	},

	async execute(interaction) {
		const serverName = interaction.options.getString('server');

		let serverConfig;
		try {
			const data = fs.readFileSync(CONFIG_PATH, 'utf8');
			serverConfig = JSON.parse(data).servers[serverName];
		} catch (e) {
			console.error(e);
			return interaction.reply({ content: strings.errors.genericError({ message: 'Error loading config file.' }), ephemeral: true });
		}

		if (!serverConfig) return interaction.reply({ content: strings.errors.noFile(serverName), ephemeral: true });

		await interaction.deferReply();

		try {
			if (isMinecraft(serverConfig)) {
				return await sendMinecraftStatus(interaction, serverName, serverConfig);
			}
			// 1. Determine Port (Use JSON > Fallback to Game Port > Fallback to +1)
			const qPort = serverConfig.queryPort || serverConfig.port || 2302;
			const qHost = serverConfig.host || '127.0.0.1';

			const state = await GameDig.query({
				type: 'arma3',
				host: qHost,
				port: qPort,
				maxAttempts: 2,
				socketTimeout: 3000,
			});

			// 2. Build Embed
			const embed = new EmbedBuilder()
				.setColor(0x00FF00)
				.setTitle(`🟢 ${serverName.toUpperCase()} is Online`)
				.addFields(
					{ name: 'Mission', value: state.map || 'Unknown', inline: true },
					{ name: 'Players', value: `${state.players.length} / ${state.maxplayers}`, inline: true },
					{ name: 'Ping', value: `${state.ping}ms`, inline: true },
				)
				.setFooter({ text: `IP: ${state.connect}` })
				.setTimestamp();

			if (state.players.length > 0) {
				const playerNames = state.players.map(p => p.name).join(', ');
				const safePlayerList = playerNames.length > 1000 ? playerNames.substring(0, 1000) + '...' : playerNames;
				embed.addFields({ name: 'Player List', value: safePlayerList });
			}

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			console.error(error);
			const embed = new EmbedBuilder()
				.setColor(0xFF0000)
				.setTitle(`🔴 ${serverName.toUpperCase()} is Offline`)
				.setDescription(`No response on Port ${serverConfig.queryPort || serverConfig.port}`)
				.setTimestamp();

			await interaction.editReply({ embeds: [embed] });
		}
	},
};

function parseRconPlayers(response) {
	const text = String(response || '');
	const separator = text.indexOf(':');
	if (separator === -1) return [];
	return text.slice(separator + 1).split(',').map(name => name.trim()).filter(Boolean);
}

async function sendMinecraftStatus(interaction, serverName, serverConfig) {
	let processes;
	try {
		processes = await findConfiguredProcesses(serverConfig);
	} catch (error) {
		return interaction.editReply({ embeds: [new EmbedBuilder()
			.setColor(0x9B51E0)
			.setTitle(`❌ Could Not Inspect ${serverName.toUpperCase()}`)
			.setDescription(error.message.slice(0, 4000))
			.setTimestamp()] });
	}
	if (processes.length === 0) {
		return interaction.editReply({ embeds: [new EmbedBuilder()
			.setColor(0xFF0000)
			.setTitle(`🔴 ${serverName.toUpperCase()} is Offline`)
			.setDescription('No matching Minecraft launcher or marked JVM was found.')
			.setTimestamp()] });
	}

	try {
		const [state, listResponse] = await Promise.all([
			GameDig.query({
				type: 'minecraftvanilla',
				host: serverConfig.host || '127.0.0.1',
				port: serverConfig.queryPort || serverConfig.port || 25565,
				maxAttempts: 2,
				socketTimeout: 5000,
			}),
			sendRcon(serverConfig, 'list'),
		]);
		const players = parseRconPlayers(listResponse);
		const embed = new EmbedBuilder()
			.setColor(0x00FF00)
			.setTitle(`🟢 ${serverName.toUpperCase()} is Online`)
			.addFields(
				{ name: 'Version', value: String(state.version || state.raw?.version?.name || 'Unknown'), inline: true },
				{ name: 'Players', value: `${players.length} / ${state.maxplayers || '?'}`, inline: true },
				{ name: 'Ping', value: `${state.ping}ms`, inline: true },
			)
			.setDescription(String(state.name || 'Minecraft Server').slice(0, 4000))
			.setFooter({ text: `${serverConfig.host || '127.0.0.1'}:${serverConfig.port || 25565}` })
			.setTimestamp();
		if (players.length > 0) embed.addFields({ name: 'Player List', value: players.join(', ').slice(0, 1024) });
		return interaction.editReply({ embeds: [embed] });
	} catch (error) {
		console.warn('[Minecraft Status] Process exists but readiness query failed:', error.message);
		return interaction.editReply({ embeds: [new EmbedBuilder()
			.setColor(0xF2C94C)
			.setTitle(`🟡 ${serverName.toUpperCase()} is Starting or Unresponsive`)
			.setDescription(`A matching process is running, but the game query or RCON is not ready.\n\n${error.message}`.slice(0, 4000))
			.setTimestamp()] });
	}
}

module.exports._parseRconPlayers = parseRconPlayers;
