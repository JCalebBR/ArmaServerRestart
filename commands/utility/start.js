const { SlashCommandBuilder } = require('discord.js');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const CONFIG_PATH = path.join(__dirname, '../../servers.json');

/**
 * Helper: Checks if a server is ALREADY running on this port
 */
function isServerRunning(targetPort) {
	return new Promise((resolve) => {
		// We strictly check for the port in the command line
		const cmd = `wmic process where "name like 'arma3server%' and CommandLine like '%-port=${targetPort}%'" get ProcessId /format:list`;
		exec(cmd, (err, stdout) => {
			if (err || !stdout.trim()) resolve(false);
			else resolve(true);
		});
	});
}

/**
 * Helper: Launches a process safely in the background
 */
function launchProcess(exePath, args) {
	const fullCommand = `"${exePath}" ${args}`;
	console.log(`[Start] Executing: ${fullCommand}`);

	const subprocess = spawn(fullCommand, {
		shell: true,
		detached: true,
		stdio: 'ignore',
	});
	subprocess.unref();
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('start')
		.setDescription('Boots up a server')
		.addStringOption(option =>
			option.setName('server')
				.setDescription('The server to start')
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
			return interaction.reply(`❌ Error loading config file.`);
		}

		if (!serverConfig) {
			return interaction.reply(`❌ Unknown server: **${serverName}**`);
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