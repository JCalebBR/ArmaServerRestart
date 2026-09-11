const { Rcon } = require('rcon-client');

class RconUnavailableError extends Error {
	constructor(message, cause) {
		super(message, { cause });
		this.name = 'RconUnavailableError';
	}
}

function rconOptions(serverConfig) {
	const config = serverConfig?.rcon || {};
	const passwordName = config.passwordEnv || 'MINECRAFT_RCON_PASSWORD';
	const password = process.env[passwordName];
	if (!password) throw new Error(`Minecraft RCON password environment variable ${passwordName} is not set.`);

	return {
		host: config.host || '127.0.0.1',
		port: Number(config.port) || 25575,
		password,
		timeout: Number(config.timeoutMs) || 5000,
	};
}

async function sendRcon(serverConfig, command, options = {}) {
	const connect = options.connect || (async config => {
		const connection = new Rcon(config);
		connection.on('error', error => {
			console.warn('[Minecraft RCON] Socket error:', error.message);
		});
		await connection.connect();
		return connection;
	});
	let client;
	try {
		client = await connect(rconOptions(serverConfig));
		if (options.connect && client.on) client.on('error', () => undefined);
		return await client.send(command);
	} catch (error) {
		if (/password environment variable/.test(error.message)) throw error;
		throw new RconUnavailableError(`Minecraft RCON command failed: ${error.message}`, error);
	} finally {
		if (client) await client.end().catch(() => undefined);
	}
}

function tellrawCommand(text, color = 'gray') {
	return `tellraw @a ${JSON.stringify({ text, color })}`;
}

async function broadcast(serverConfig, text, options = {}) {
	return sendRcon(serverConfig, tellrawCommand(text, options.color || 'gold'), options);
}

module.exports = {
	RconUnavailableError,
	broadcast,
	rconOptions,
	sendRcon,
	tellrawCommand,
};
