const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');
const { tryAcquireServerOperation } = require('../utils/operationCoordinator');
const {
	ServerTerminationError,
	countConfiguredProcesses,
	findConfiguredProcesses,
	isMinecraft,
	stopServer,
} = require('../utils/serverLifecycle');

const CONFIG_PATH = path.join(__dirname, '../servers.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.stop.name)
		.setDescription(strings.commands.stop.desc)
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
		try {
			config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
		} catch (error) {
			console.error('Error reading servers.json', error);
		}

		const choices = config.servers ? Object.keys(config.servers) : [];
		const filtered = choices.filter(choice => choice.toLowerCase().startsWith(focusedValue.toLowerCase())).slice(0, 25);
		await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
	},

	async execute(interaction) {
		const serverName = interaction.options.getString('server', true);
		let serverConfig;
		try {
			const fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
			serverConfig = fullConfig.servers[serverName];
		} catch (error) {
			console.error(error);
			return interaction.reply({ content: strings.errors.genericError({ message: 'Error loading config file.' }), ephemeral: true });
		}

		if (!serverConfig) {
			return interaction.reply({ content: strings.errors.genericError({ message: 'Unknown server: **' + serverName + '**' }), ephemeral: true });
		}

		await interaction.deferReply();
		const operationLease = tryAcquireServerOperation(serverConfig.port);
		if (!operationLease.acquired) {
			const message = operationLease.reason === 'maintenance'
				? '⚠️ Mods are currently being updated. Server lifecycle commands are temporarily locked.'
				: '⚠️ Another lifecycle operation is already running for **' + serverName + '**.';
			return interaction.editReply(message);
		}

		try {
			const processes = await findConfiguredProcesses(serverConfig);
			if (processes.length === 0) {
				return interaction.editReply('⚠️ **' + serverName + '** is already offline. No matching process arguments were found.');
			}

			const counts = countConfiguredProcesses(processes, serverConfig);
			await interaction.editReply(isMinecraft(serverConfig)
				? '🛑 Saving **' + serverName + '** and requesting a graceful shutdown...'
				: '🛑 Found **' + counts.serverCount + '** server and **' + counts.hcCount + '** HC process(es). Terminating all matching processes...');
			const result = await stopServer(serverConfig);
			await interaction.editReply(
				'✅ **' + serverName.toUpperCase() + '** is stopped. Verified removal of **' + result.terminatedCount + '** process(es).',
			);
		} catch (error) {
			console.error('[Stop] Failed for ' + serverName + ':', error);
			if (error instanceof ServerTerminationError) {
				const counts = countConfiguredProcesses(error.processes, serverConfig);
				if (isMinecraft(serverConfig)) {
					return interaction.editReply('❌ Stop verification failed. Matching Minecraft launcher/JVM processes remain and may require manual cleanup.');
				}
				return interaction.editReply(
					'❌ Stop verification failed. **' + counts.serverCount + '** server and **' + counts.hcCount + '** HC process(es) remain and may require manual cleanup.',
				);
			}
			await interaction.editReply('❌ Could not inspect or stop **' + serverName + '**: ' + error.message);
		} finally {
			operationLease.release();
		}
	},
};
