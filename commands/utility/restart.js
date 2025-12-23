const SERVERS = {
	'Black Templars': '2302',
	'21st Cadian': '2402',
	'SCP Fun Ops': '2502',
};
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function findArmaProcess(targetPort) {
	return new Promise((resolve) => {
		// PowerShell command to get process info as JSON
		// We use Get-CimInstance (modern replacement for WMI)
		const psCommand = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name='arma3server_x64.exe'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"`;

		exec(psCommand, (error, stdout) => {
			if (error) {
				// If no processes found, ConvertTo-Json might error or return null, handle gracefully
				return resolve(null);
			}

			try {
				const output = stdout.trim();
				if (!output) return resolve(null);

				// Handle case where single result is object, multiple is array
				let processes = JSON.parse(output);
				if (!Array.isArray(processes)) processes = [processes];

				// Find the specific process matching our port
				const match = processes.find(proc =>
					proc.CommandLine && proc.CommandLine.includes(`-port=${targetPort}`),
				);

				if (match) {
					resolve({
						pid: match.ProcessId,
						commandLine: match.CommandLine,
					});
				} else {
					resolve(null);
				}
			} catch (e) {
				console.error("JSON Parse Error:", e);
				resolve(null);
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
		.setDescription('Kills and Relaunches an Arma 3 Server')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addStringOption(option =>
			option.setName('server')
				.setDescription('The server to restart')
				.setRequired(true)
				.addChoices(
					...Object.keys(SERVERS).map(name => ({ name: name, value: name })),
				),
		),

	async execute(interaction) {
		const serverName = interaction.options.getString('server', true);
		const targetPort = SERVERS[serverName];

		await interaction.deferReply();

		try {
			// STEP 1: Find it
			const procInfo = await findArmaProcess(targetPort);

			if (!procInfo) {
				return interaction.editReply(`⚠️ Could not find a running **${serverName}** server on port ${targetPort}.`);
			}

			// STEP 2: Kill it
			await interaction.editReply(`found PID ${procInfo.pid}. Killing...`);
			await killProcess(procInfo.pid);

			// Wait 2 seconds to ensure file locks are released
			await new Promise(r => setTimeout(r, 2000));

			// STEP 3: Relaunch it
			relaunchProcess(procInfo.commandLine);

			await interaction.editReply(`✅ **${serverName.toUpperCase()}** cycled successfully.\nPID: ${procInfo.pid} → Killed → Relaunched.`);

		} catch (error) {
			console.error(error);
			await interaction.editReply('❌ Internal error during restart sequence.');
		}
	},
};