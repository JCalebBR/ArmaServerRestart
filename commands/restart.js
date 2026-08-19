const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');
const { tryAcquireServerOperation } = require('../utils/operationCoordinator');
const {
	countProcessTypes,
	findConfiguredServerProcesses,
	restartConfiguredServer,
} = require('../utils/server');

const CONFIG_PATH = path.join(__dirname, '../servers.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.restart.name)
		.setDescription(strings.commands.restart.desc)
		.addStringOption(option =>
			option.setName(strings.commands.restart.args.first.name)
				.setDescription(strings.commands.restart.args.first.desc)
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
				? '⚠️ Mods are currently being updated. The server cannot be restarted yet.'
				: '⚠️ Another lifecycle operation is already running for **' + serverName + '**.';
			return interaction.editReply(message);
		}

		try {
			const initialProcesses = await findConfiguredServerProcesses(serverConfig);
			const initialCounts = countProcessTypes(initialProcesses);
			if (initialProcesses.length > 0) {
				await interaction.editReply(
					'🛑 Restart found **' + initialCounts.serverCount + '** server and **' + initialCounts.hcCount + '** HC process(es). Removing all of them...',
				);
			} else {
				await interaction.editReply('ℹ️ **' + serverName + '** is offline. Starting its configured process state...');
			}

			const restartResult = await restartConfiguredServer(fullConfig, serverConfig, {
				startOptions: {
					onProgress: async progress => {
						if (progress.phase === 'launching_server') {
							await interaction.editReply('🚀 Launching a clean **' + serverName + '** server process...');
						}
						if (progress.phase === 'waiting_for_hcs') {
							await interaction.editReply('✅ Server process verified. Waiting 10s before launching ' + progress.hcCount + ' HC(s)...');
						}
						if (progress.phase === 'launching_hc') {
							await interaction.editReply('🚀 Launching HC **' + progress.index + ' of ' + progress.hcCount + '** for **' + serverName + '**...');
						}
						if (progress.phase === 'rolling_back') {
							await interaction.editReply('⚠️ Restart verification failed. Rolling back **' + serverName + '**...');
						}
					},
				},
			});
			const result = restartResult.startResult;

			await interaction.editReply(
				'✅ **' + serverName.toUpperCase() + '** restart verified. Running **' + result.serverCount + '** server and **' + result.hcCount + '** HC(s).',
			);
		} catch (error) {
			console.error('[Restart] Failed for ' + serverName + ':', error);
			const rollbackMessage = error.rollbackError
				? ' Rollback also failed; manual process cleanup is required.'
				: '';
			await interaction.editReply('❌ **' + serverName + '** could not be restarted: ' + error.message + rollbackMessage);
		} finally {
			operationLease.release();
		}
	},
};
