module.exports = {
	data: new SlashCommandBuilder().setName('reload').setDescription('Reloads commands'),
	async execute(interaction) {
		const cmd = `wmic process where "name='arma3server_x64.exe'" get ProcessId,CommandLine /format:csv`;

		exec(cmd, (error, stdout, stderr) => {
			if (error) {
				console.error(`WMIC Error: ${error.message}`);
				return resolve(false);
			}

			// Parse the CSV output
			const lines = stdout.trim().split('\r\n');
			let killed = false;

			// Skip the first line (headers)
			for (let i = 1; i < lines.length; i++) {
				const line = lines[i];
				if (!line) continue;

				// WMIC CSV format usually: Node,CommandLine,ProcessId
				// We just check if the line contains our port and is the right executable
				if (line.includes(`-port=${targetPort}`)) {
					const parts = line.split(',');
					// The PID is usually the last element in the CSV line
					const pid = parts[parts.length - 1];

					console.log(`Found Server on port ${targetPort} (PID: ${pid}). Killing...`);

					// Kill the process forcefully
					exec(`taskkill /PID ${pid} /F`, (killErr) => {
						if (killErr) {
							console.error(`Failed to kill PID ${pid}: ${killErr.message}`);
							resolve(false);
						} else {
							resolve(true);
						}
					});
					killed = true;
					break; // Stop after killing the correct one
				}
			}

			if (!killed) resolve(false);
		});
	},
};

function killArmaByPort(targetPort) {
	return new Promise((resolve, reject) => {
		// WMIC command to list all arma3server_x64.exe processes with their Command Line

	});
}