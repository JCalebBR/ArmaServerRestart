const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');
const { launchProcess, isServerRunning } = require('../utils/server');

const CONFIG_PATH = path.join(__dirname, '../servers.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.start.name)
		.setDescription(strings.commands.start.desc)
		.addStringOption(option =>
			option.setName(strings.commands.start.args.first.name)
				.setDescription(strings.commands.start.args.first.desc)
				.setRequired(true)
				.setAutocomplete(true),
		),

	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();
		let config = {};

		try {
			const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
			config = JSON.parse(fileContent);
		} catch (e) { console.error("Error reading server master file", e); }

		const choices = config.servers ? Object.keys(config.servers) : [];
		const filtered = choices.filter(choice => choice.startsWith(focusedValue));

		await interaction.respond(
			filtered.map(choice => ({ name: choice, value: choice })),
		);
	},

	async execute(interaction) {
		const serverName = interaction.options.getString('server');
		let fullConfig;
		let serverConfig;

		// 2. Load Config
		try {
			const data = fs.readFileSync(CONFIG_PATH, 'utf8');
			fullConfig = JSON.parse(data);
			serverConfig = fullConfig.servers[serverName];
		} catch (e) {
			console.error(e);
			return interaction.reply({ content: strings.errors.genericError({ message: 'Error loading config file.' }), ephemeral: true });
		}

		if (!serverConfig) {
			return interaction.reply({ content: strings.errors.noFile(serverName), ephemeral: true });
		}

		await interaction.deferReply();

		// 3. Check Status (Using the explicit 'port' property)
		const isRunning = await isServerRunning(serverConfig.port);
		if (isRunning) {
			return interaction.editReply(`⚠️ **${serverName}** (Port ${serverConfig.port}) is ALREADY running.`);
		}

		// 4. Launch Server
		await interaction.editReply(`🚀 Launching **${serverName}** Server on Port ${serverConfig.port}...`);

		// Use global EXE path + specific Server Args
		launchProcess(fullConfig.exePath, serverConfig.serverArgs);

		// 5. Handle Headless Clients
		if (serverConfig.hcCount > 0) {
			await interaction.editReply(`✅ Server process started. Waiting 10s before spawning ${serverConfig.hcCount} HCs...`);

			await new Promise(r => setTimeout(r, 10000));

			for (let i = 0; i < serverConfig.hcCount; i++) {
				launchProcess(fullConfig.exePath, serverConfig.hcArgs);
				await new Promise(r => setTimeout(r, 2000));
			}

			await interaction.editReply(`✅ **${serverName}** Startup Complete.`);
		} else {
			await interaction.editReply(`✅ **${serverName}** Startup Complete.`);
		}
	},
};