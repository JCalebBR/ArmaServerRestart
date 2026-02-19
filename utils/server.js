const { exec, spawn } = require('child_process');
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

function killProcess(pid) {
	return new Promise((resolve) => {
		exec(`taskkill /PID ${pid} /F`, () => resolve(true));
	});
}

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


function launchProcess(exePath, args) {
	// We use the Windows 'start' command.
	// Syntax: start "Window Title" /MIN "Path/To/Exe" arguments...
	// /MIN launches it minimized (optional, good for keeping the server clean)
	const command = `start "Arma3Server" /MIN "${exePath}" ${args}`;

	console.log(`[Start] Decoupling process: ${command}`);

	const subprocess = spawn(command, {
		shell: true,
		detached: true,
		stdio: 'ignore',
	});

	subprocess.unref();
}

module.exports = {
	findArmaProcesses,
	killProcess,
	relaunchProcess,
	isServerRunning,
	launchProcess,
};