const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Gamedig = require('gamedig');
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
		// Reuse the same autocomplete logic as start/restart
		const focusedValue = interaction.options.getFocused();
		let config = {};
		try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { }

		const choices = config.servers ? Object.keys(config.servers) : [];
		const filtered = choices.filter(choice => choice.startsWith(focusedValue));
		await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
	},

	async execute(interaction) {
		const serverName = interaction.options.getString('server');

		// 1. Load Config
		let serverConfig;
		try {
			const data = fs.readFileSync(CONFIG_PATH, 'utf8');
			serverConfig = JSON.parse(data).servers[serverName];
		} catch (e) { return interaction.reply({ content: `❌ Error loading config.`, ephemeral: true }); }

		if (!serverConfig) return interaction.reply({ content: `❌ Unknown server.`, ephemeral: true });

		await interaction.deferReply();

		try {
			// 2. Query the Server
			// We assume queryPort is port + 1 if not specified in JSON
			const qPort = serverConfig.queryPort || (parseInt(serverConfig.port) + 1);

			const state = await Gamedig.query({
				type: 'arma3',
				host: '127.0.0.1',
				port: qPort,
				maxAttempts: 2,
			});

			// 3. Build the Embed (Rich Card)
			const embed = new EmbedBuilder()
				.setColor(0x00FF00)
				.setTitle(`🟢 ${serverName.toUpperCase()} is Online`)
				.addFields(
					{ name: 'Mission', value: state.map || 'Unknown', inline: true },
					{ name: 'Players', value: `${state.players.length} / ${state.maxplayers}`, inline: true },
					{ name: 'Ping', value: `${state.ping}ms`, inline: true },
				)
				.setTimestamp();

			// Optional: List players nicely
			if (state.players.length > 0) {
				const playerNames = state.players.map(p => p.name).join(', ');
				// Discord fields have a 1024 char limit, so we truncate if needed
				const safePlayerList = playerNames.length > 1000 ? playerNames.substring(0, 1000) + '...' : playerNames;
				embed.addFields({ name: 'Player List', value: safePlayerList });
			}

			await interaction.editReply({ embeds: [embed] });

		} catch (error) {
			// If query fails, server is likely offline
			const embed = new EmbedBuilder()
				.setColor(0xFF0000)
				.setTitle(`🔴 ${serverName.toUpperCase()} is Offline`)
				.setDescription(`Could not reach query port ${serverConfig.queryPort || parseInt(serverConfig.port) + 1}.`)
				.setTimestamp();

			await interaction.editReply({ embeds: [embed] });
		}
	},
};