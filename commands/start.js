const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');
const { tryAcquireServerOperation } = require('../utils/operationCoordinator');
const {
	ServerProcessesExistError,
	countProcessTypes,
	startConfiguredServer,
} = require('../utils/server');

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
			config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
		} catch (error) {
			console.error('Error reading server master file', error);
		}

		const choices = config.servers ? Object.keys(config.servers) : [];
		const filtered = choices.filter(choice => choice.startsWith(focusedValue));
		await interaction.respond(filtered.map(choice => ({ name: choice, value: choice })));
	},

	async execute(interaction) {
		const serverName = interaction.options.getString('server', true);
		let fullConfig;
		let serverConfig;

		try {
			fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
			serverConfig = fullConfig.servers[serverName];
		} catch (error) {
			console.error(error);
			return interaction.reply({ content: strings.errors.genericError({ message: 'Error loading config file.' }), ephemeral: true });
		}

		if (!serverConfig) {
			return interaction.reply({ content: strings.errors.noFile(serverName), ephemeral: true });
		}

		await interaction.deferReply();
		const operationLease = tryAcquireServerOperation(serverConfig.port);
		if (!operationLease.acquired) {
			const message = operationLease.reason === 'maintenance'
				? '⚠️ Mods are currently being updated. The server cannot be started yet.'
				: '⚠️ Another lifecycle operation is already running for **' + serverName + '**.';
			return interaction.editReply(message);
		}

		try {
			const result = await startConfiguredServer(fullConfig, serverConfig, {
				onProgress: async progress => {
					if (progress.phase === 'launching_server') {
						await interaction.editReply('🚀 Launching **' + serverName + '** on Port ' + serverConfig.port + '...');
					}
					if (progress.phase === 'waiting_for_hcs') {
						await interaction.editReply('✅ Server process verified. Waiting 10s before launching ' + progress.hcCount + ' HC(s)...');
					}
					if (progress.phase === 'launching_hc') {
						await interaction.editReply('🚀 Launching HC **' + progress.index + ' of ' + progress.hcCount + '** for **' + serverName + '**...');
					}
					if (progress.phase === 'rolling_back') {
						await interaction.editReply('⚠️ Startup verification failed. Rolling back **' + serverName + '**...');
					}
				},
			});

			await interaction.editReply(
				'✅ **' + serverName + '** startup verified. Running **' + result.serverCount + '** server and **' + result.hcCount + '** HC(s).',
			);
		} catch (error) {
			console.error('[Start] Failed for ' + serverName + ':', error);
			if (error instanceof ServerProcessesExistError) {
				const counts = countProcessTypes(error.processes);
				return interaction.editReply(
					'⚠️ **' + serverName + '** already has **' + counts.serverCount + '** server and **' + counts.hcCount + '** HC process(es). Nothing was launched. Use /stop or /restart to normalize them.',
				);
			}

			const rollbackMessage = error.rollbackError
				? ' Rollback also failed; manual process cleanup is required.'
				: ' All matching processes were rolled back.';
			await interaction.editReply('❌ **' + serverName + '** failed to start: ' + error.message + rollbackMessage);
		} finally {
			operationLease.release();
		}
	},
};
