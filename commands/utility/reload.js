const { exec } = require('child_process');

// --- CONFIGURATION ---
// Add your specific ports here
const SERVERS = {
	'Black Templars': '2302',
	'21st Cadian': '2402',
	'SCP Fun Ops': '2502',
};

/**
 * Helper: Finds and kills the Arma process by Port using WMIC and Taskkill
 */
function killArmaByPort(targetPort) {
	return new Promise((resolve, reject) => {
		const cmd = `wmic process where "name='arma3server_x64.exe'" get ProcessId,CommandLine /format:csv`;

		exec(cmd, (error, stdout, stderr) => {
			if (error) {
				console.error(`WMIC Error: ${error.message}`);
				return resolve(false);
			}

			const lines = stdout.trim().split('\r\n');
			let killed = false;

			for (let i = 1; i < lines.length; i++) {
				const line = lines[i];
				if (!line) continue;

				if (line.includes(`-port=${targetPort}`)) {
					const parts = line.split(',');
					const pid = parts[parts.length - 1];

					console.log(`[Restart] Killing PID: ${pid} on Port: ${targetPort}`);

					exec(`taskkill /PID ${pid} /F`, (killErr) => {
						if (killErr) resolve(false);
						else resolve(true);
					});
					killed = true;
					break;
				}
			}
			if (!killed) resolve(false);
		});
	});
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('restart')
		.setDescription('Restarts a specific Arma 3 Server')
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addStringOption(option =>
			option.setName('server')
				.setDescription('The server to restart')
				.setRequired(true)
				.addChoices(...Object.keys(SERVERS).map(name => ({ name, value: name }))),
		),
	async execute(interaction) {
		const serverName = interaction.options.getString('server', true);
		const targetPort = SERVERS[serverName];

		// We use deferReply because searching processes can take >3 seconds
		await interaction.deferReply();

		try {
			const success = await killArmaByPort(targetPort);

			if (success) {
				await interaction.editReply(`✅ **${serverName.toUpperCase()}** (Port ${targetPort}) has been terminated.\nFASTER should auto-restart it shortly.`);
			} else {
				await interaction.editReply(`⚠️ **${serverName.toUpperCase()}** not found.\nIs the server actually running?`);
			}
		} catch (error) {
			console.error(error);
			await interaction.editReply('❌ There was an error while executing this command.');
		}
	},
};