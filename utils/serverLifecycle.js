const arma = require('./server');
const minecraft = require('./minecraft');
const { getServerKind } = require('./config');

function isMinecraft(serverConfig) {
	return getServerKind(serverConfig) === 'minecraft';
}

function findConfiguredProcesses(serverConfig, options = {}) {
	return isMinecraft(serverConfig)
		? minecraft.findMinecraftProcesses(serverConfig, options)
		: arma.findConfiguredServerProcesses(serverConfig, options);
}

function countConfiguredProcesses(processes, serverConfig) {
	if (isMinecraft(serverConfig)) {
		return { serverCount: minecraft.minecraftJvmCount(processes), hcCount: 0 };
	}
	return arma.countProcessTypes(processes);
}

function startServer(fullConfig, serverConfig, options = {}) {
	return isMinecraft(serverConfig)
		? minecraft.startMinecraftServer(serverConfig, options)
		: arma.startConfiguredServer(fullConfig, serverConfig, options);
}

function stopServer(serverConfig, options = {}) {
	return isMinecraft(serverConfig)
		? minecraft.stopMinecraftServer(serverConfig, options)
		: arma.stopConfiguredServer(serverConfig, options);
}

function restartServer(fullConfig, serverConfig, options = {}) {
	return isMinecraft(serverConfig)
		? minecraft.restartMinecraftServer(serverConfig, options)
		: arma.restartConfiguredServer(fullConfig, serverConfig, options);
}

module.exports = {
	...arma,
	countConfiguredProcesses,
	findConfiguredProcesses,
	isMinecraft,
	restartServer,
	startServer,
	stopServer,
};
