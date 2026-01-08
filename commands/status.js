const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GameDig } = require('gamedig');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../servers.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('status')
		.setDescription('Checks the status of a server')
		.addStringOption(option =>
			option.setName('server')
				.setDescription('The server to query')
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
		const filtered = choices.filter(choice => choice.startsWith(focusedValue));
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
			return interaction.reply({ content: `❌ Error loading config.`, ephemeral: true });
		}

		if (!serverConfig) return interaction.reply({ content: `❌ Unknown server.`, ephemeral: true });

		await interaction.deferReply();

		try {
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