const SERVERS = {
	'Black Templars': '2302',
	'21st Cadian': '2402',
	'SCP Fun Ops': '2502',
};
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function findArmaProcesses(targetPort) {
	return new Promise((resolve) => {
		// PowerShell to get all arma processes
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

				// Map to a cleaner format and tag them
				const results = matches.map(proc => {
					const cmd = proc.CommandLine.toLowerCase();
					const isClient = cmd.includes('-client');
					return {
						pid: proc.ProcessId,
						commandLine: proc.CommandLine,
						type: isClient ? 'HEADLESS CLIENT' : 'SERVER'
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
		exec(`taskkill /PID ${pid} /F`, () => {
			// We resolve true regardless, as long as the process is gone
			resolve(true);
		});
	});
}

/**
 * 3. RESURRECT: Launches the command string in a detached shell
 */
function relaunchProcess(commandLine) {
	console.log(`[Resurrecting] executing: ${commandLine}`);

	// shell: true allows us to pass the full command string (executable + args)
	// detached: true ensures the server stays alive even if the bot dies
	const subprocess = spawn(commandLine, {
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
				.addChoices(
					...Object.keys(SERVERS).map(name => ({ name: name, value: name }))
				)
		),

	async execute(interaction) {
		// Security Check
		const serverName = interaction.options.getString('server', true);
		const targetPort = SERVERS[serverName];

		await interaction.deferReply();

		try {
			// STEP 1: Find processes
			const targets = await findArmaProcesses(targetPort);

			if (targets.length === 0) {
				return interaction.editReply(`⚠️ No running processes found for **${serverName}** (Port ${targetPort}).`);
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

			// Sort: Server first (false comes before true in sort? No, we check type manually)
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