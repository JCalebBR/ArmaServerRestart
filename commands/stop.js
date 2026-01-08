const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const CONFIG_PATH = path.join(__dirname, '../servers.json');

function findArmaProcesses(targetPort) {
	return new Promise((resolve) => {
		const psCommand = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name like 'arma3server%'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"`;

		exec(psCommand, (error, stdout) => {
			if (error || !stdout.trim()) return resolve([]);

			try {
				let processes = JSON.parse(stdout.trim());
				if (!Array.isArray(processes)) processes = [processes];

				// Filter for our specific port
				const matches = processes.filter(proc => {
					const cmd = (proc.CommandLine || "").toLowerCase();
					return cmd.includes(`port=${targetPort}`) || cmd.includes(`port ${targetPort}`);
				});

				// Tag them
				const results = matches.map(proc => {
					const cmd = proc.CommandLine.toLowerCase();
					const isClient = cmd.includes('-client');
					return {
						pid: proc.ProcessId,
						type: isClient ? 'HEADLESS CLIENT' : 'SERVER',
					};
				});

				resolve(results);
			} catch (e) {
				console.error("JSON Parse Error:", e);
				resolve([]);
			}
		});
	});
}

/**
 * 2. KILL: Terminates the specific PID
 */
function killProcess(pid) {
	return new Promise((resolve) => {
		exec(`taskkill /PID ${pid} /F`, () => resolve(true));
	});
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('stop')
		.setDescription('Shuts down a Server and its Headless Clients')
		// Default to Admin only (you can override in Server Settings)
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addStringOption(option =>
			option.setName('server')
				.setDescription('The server to stop')
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
			return interaction.reply({ content: `❌ Error loading config file.`, ephemeral: true });
		}

		if (!serverConfig) {
			return interaction.reply({ content: `❌ Unknown server: **${serverName}**`, ephemeral: true });
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
			await interaction.editReply('❌ Internal error during shutdown sequence.');
		}
	},
};