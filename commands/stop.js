const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');
const { findArmaProcesses, killProcess } = require('../utils/server');

const CONFIG_PATH = path.join(__dirname, '../servers.json');


module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.stop.name)
		.setDescription(strings.commands.stop.desc)
		// Default to Admin only (you can override in Server Settings)
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addStringOption(option =>
			option.setName(strings.commands.stop.args.first.name)
				.setDescription(strings.commands.stop.args.first.desc)
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
		const serverName = interaction.options.getString('server', true);

		// 1. READ CONFIG
		let serverConfig;
		try {
			const data = fs.readFileSync(CONFIG_PATH, 'utf8');
			serverConfig = JSON.parse(data).servers[serverName];
		} catch (e) {
			console.error(e);
			return interaction.reply({ content: strings.errors.genericError({ message: 'Error loading config file.' }), ephemeral: true });
		}

		if (!serverConfig) {
			return interaction.reply({ content: strings.errors.genericError({ message: `Unknown server: **${serverName}**` }), ephemeral: true });
		}

		const targetPort = serverConfig.port;

		await interaction.deferReply();

		try {
			// STEP 1: Find processes
			const targets = await findArmaProcesses(targetPort);

			if (targets.length === 0) {
				return interaction.editReply(`⚠️ **${serverName}** is already offline (No processes on Port ${targetPort}).`);
			}

			const serverCount = targets.filter(t => t.type === 'SERVER').length;
			const hcCount = targets.filter(t => t.type === 'HEADLESS CLIENT').length;

			await interaction.editReply(`🛑 Found **${serverCount}** Server and **${hcCount}** HC(s). Shutting down...`);

			// STEP 2: Kill
			for (const target of targets) {
				await killProcess(target.pid);
			}

			// Small delay to ensure Windows cleans up
			await new Promise(r => setTimeout(r, 2000));

			await interaction.editReply(`✅ **${serverName.toUpperCase()}** has been stopped successfully.`);

		} catch (error) {
			console.error(error);
			await interaction.editReply(strings.errors.genericError({ message: 'Internal error during stop sequence.' }));
		}
	},
};