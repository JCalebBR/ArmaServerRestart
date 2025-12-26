const { SlashCommandBuilder } = require('discord.js');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const CONFIG_PATH = path.join(__dirname, '../servers.json');

/**
 * 1. SCOUT: Finds ALL processes matching the port
 */
function findArmaProcesses(targetPort) {
	return new Promise((resolve) => {
		const psCommand = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name like 'arma3server%'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"`;

		exec(psCommand, (error, stdout) => {
			if (error || !stdout.trim()) return resolve([]);

			try {
				let processes = JSON.parse(stdout.trim());
				if (!Array.isArray(processes)) processes = [processes];

				const matches = processes.filter(proc => {
					const cmd = (proc.CommandLine || "").toLowerCase();
					return cmd.includes(`port=${targetPort}`) || cmd.includes(`port ${targetPort}`);
				});

				const results = matches.map(proc => {
					const cmd = proc.CommandLine.toLowerCase();
					const isClient = cmd.includes('-client');
					return {
						pid: proc.ProcessId,
						commandLine: proc.CommandLine,
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
 * 2. KILL
 */
function killProcess(pid) {
	return new Promise((resolve) => {
		exec(`taskkill /PID ${pid} /F`, () => resolve(true));
	});
}

/**
 * 3. RESURRECT
 */
function relaunchProcess(commandLine) {
	const decoupledCommand = `start "RestoredServer" /MIN ${commandLine}`;

	console.log(`[Resurrecting] executing: ${decoupledCommand}`);

	const subprocess = spawn(decoupledCommand, {
		shell: true,
		detached: true,
		stdio: 'ignore',
	});

	subprocess.unref();
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('restart')
		.setDescription('Restarts Server AND Headless Clients')
		.addStringOption(option =>
			option.setName('server')
				.setDescription('The server to restart')
				.setRequired(true)
				.setAutocomplete(true),
		),

	// NEW: Handle the dynamic choices from servers.json
	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();
		let config = {};

		try {
			const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
			config = JSON.parse(fileContent);
		} catch (e) { console.error("Error reading servers.json", e); }

		// Get keys from the "servers" object
		const choices = config.servers ? Object.keys(config.servers) : [];
		const filtered = choices.filter(choice => choice.startsWith(focusedValue));

		await interaction.respond(
			filtered.map(choice => ({ name: choice, value: choice })),
		);
	},

	async execute(interaction) {
		const serverName = interaction.options.getString('server', true);

		// 1. READ CONFIG (To get the Port)
		let serverConfig;
		try {
			const data = fs.readFileSync(CONFIG_PATH, 'utf8');
			const fullConfig = JSON.parse(data);
			serverConfig = fullConfig.servers[serverName];
		} catch (e) {
			return interaction.reply({ content: `❌ Error loading config file.`, ephemeral: true });
		}

		if (!serverConfig) {
			return interaction.reply({ content: `❌ Unknown server: **${serverName}**`, ephemeral: true });
		}

		const targetPort = serverConfig.port;

		await interaction.deferReply();

		try {
			// STEP 1: Find processes (Using the agnostic logic)
			const targets = await findArmaProcesses(targetPort);

			if (targets.length === 0) {
				return interaction.editReply(`⚠️ No running processes found for **${serverName}** (Port ${targetPort}).\nUse \`/start\` if the server is offline.`);
			}

			// Report what we found
			const serverCount = targets.filter(t => t.type === 'SERVER').length;
			const hcCount = targets.filter(t => t.type === 'HEADLESS CLIENT').length;
			await interaction.editReply(`Found **${serverCount}** Server and **${hcCount}** HC(s). Killing...`);

			// STEP 2: Kill EVERYTHING found
			for (const target of targets) {
				await killProcess(target.pid);
			}

			// Wait 2 seconds for clean shutdown
			await new Promise(r => setTimeout(r, 2000));

			// STEP 3: Relaunch (Server First -> Then Clients)
			const serverProc = targets.find(t => t.type === 'SERVER');
			const clientProcs = targets.filter(t => t.type === 'HEADLESS CLIENT');

			if (serverProc) {
				console.log(`[Restart] Launching Server...`);
				relaunchProcess(serverProc.commandLine);
			}

			// Wait 5 seconds before starting HCs so the server can initialize
			if (clientProcs.length > 0) {
				await interaction.editReply(`✅ Server launched. Waiting 5s to launch Headless Clients...`);
				await new Promise(r => setTimeout(r, 5000));

				for (const client of clientProcs) {
					console.log(`[Restart] Launching HC...`);
					relaunchProcess(client.commandLine);
				}
			}

			await interaction.editReply(`✅ **${serverName.toUpperCase()}** full restart complete.\n(Server + ${clientProcs.length} HCs cycled)`);

		} catch (error) {
			console.error(error);
			await interaction.editReply('❌ Internal error during restart sequence.');
		}
	},
};