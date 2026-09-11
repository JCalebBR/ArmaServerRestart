const cron = require('node-cron');
const { getMinecraftEntry } = require('./config');
const { MinecraftLogTailer, minecraftToDiscord, parseMinecraftChatLine } = require('./minecraftChat');
const {
	findMinecraftProcesses,
	minecraftPaths,
	restartMinecraftServer,
	validateMinecraftConfig,
} = require('./minecraft');
const { broadcast } = require('./minecraftRcon');
const { processWhitelistQueue } = require('./minecraftState');
const { tryAcquireServerOperation } = require('./operationCoordinator');

function formatWarning(seconds) {
	if (seconds >= 60) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
	return `${seconds} seconds`;
}

function secondsUntilNextFourHourRestart(date = new Date()) {
	const next = new Date(date);
	next.setMilliseconds(0);
	next.setSeconds(0);
	next.setMinutes(0);
	let nextHour = Math.ceil((date.getHours() + (date.getMinutes() || date.getSeconds() ? 1 : 0)) / 4) * 4;
	if (nextHour >= 24) {
		next.setDate(next.getDate() + 1);
		nextHour = 0;
	}
	next.setHours(nextHour);
	return { next, seconds: Math.round((next.getTime() - date.getTime()) / 1000) };
}

async function getTextChannel(client, channelId) {
	if (!channelId) return null;
	try {
		const channel = await client.channels.fetch(channelId);
		return channel?.isTextBased() ? channel : null;
	} catch {
		return null;
	}
}

async function notifyChannel(client, config, payload) {
	const channel = await getTextChannel(client, config.discordChannelId);
	if (!channel) return null;
	return channel.send(typeof payload === 'string' ? { content: payload } : payload);
}

function createMinecraftServices(client, entry = getMinecraftEntry(), options = {}) {
	const serverConfig = entry.config;
	validateMinecraftConfig(serverConfig);
	let queueRunning = false;
	let scheduledLease = null;
	let scheduledTarget = null;
	const warningKeys = new Set();

	const processQueue = async () => {
		if (queueRunning) return [];
		queueRunning = true;
		try {
			return await processWhitelistQueue(serverConfig, {
				onRejected: async (row, error) => notifyChannel(client, serverConfig, {
					content: `<@${row.requester_user_id}> ❌ The queued whitelist ${row.action} for **${row.minecraft_name}** was rejected: ${error.message}`,
					allowedMentions: { users: [row.requester_user_id] },
				}),
			});
		} finally {
			queueRunning = false;
		}
	};

	const tailer = new MinecraftLogTailer(minecraftPaths(serverConfig).latestLog, async line => {
		const chat = parseMinecraftChatLine(line);
		if (!chat) return;
		const content = minecraftToDiscord(chat.content, client.emojis.cache);
		await notifyChannel(client, serverConfig, {
			content: `⛏️ **${chat.player}:** ${content}`.slice(0, 2000),
			allowedMentions: { parse: [] },
		});
	}, options.tailerOptions);

	const warnings = new Set(serverConfig.scheduledRestart?.warnings || [600, 300, 60, 10]);
	const warningTask = cron.createTask('*/10 * * * * *', async () => {
		const now = new Date();
		const { next, seconds } = secondsUntilNextFourHourRestart(now);
		if (!warnings.has(seconds)) return;
		const key = `${next.toISOString()}:${seconds}`;
		if (warningKeys.has(key)) return;
		warningKeys.add(key);
		const running = await findMinecraftProcesses(serverConfig);
		if (running.length === 0) return;

		if (seconds === 60 && !scheduledLease) {
			const lease = tryAcquireServerOperation(serverConfig.port);
			if (!lease.acquired) {
				scheduledTarget = `skip:${next.toISOString()}`;
				await notifyChannel(client, serverConfig, '⚠️ The scheduled Minecraft restart was skipped because another server or maintenance operation owns the lifecycle lock.');
				return;
			}
			scheduledLease = lease;
			scheduledTarget = next.toISOString();
		}

		const warning = `Minecraft will restart in ${formatWarning(seconds)}.`;
		await Promise.allSettled([
			broadcast(serverConfig, `[Marcus] ${warning}`),
			notifyChannel(client, serverConfig, `⚠️ **${warning}**`),
		]);
	}, { noOverlap: true });

	const restartTask = cron.createTask(serverConfig.scheduledRestart?.cron || '0 0 */4 * * *', async () => {
		const target = new Date().toISOString();
		if (scheduledTarget?.startsWith('skip:')) {
			scheduledTarget = null;
			return;
		}
		let lease = scheduledLease;
		if (!lease) lease = tryAcquireServerOperation(serverConfig.port);
		scheduledLease = null;
		scheduledTarget = null;
		if (!lease.acquired) {
			await notifyChannel(client, serverConfig, '⚠️ The scheduled Minecraft restart was skipped because another lifecycle operation is active.');
			return;
		}
		try {
			const running = await findMinecraftProcesses(serverConfig);
			if (running.length === 0) return;
			const startedAt = Date.now();
			await notifyChannel(client, serverConfig, '🔄 Scheduled Minecraft restart started. Saving the world...');
			const result = await restartMinecraftServer(serverConfig);
			const seconds = Math.round((Date.now() - startedAt) / 1000);
			await notifyChannel(client, serverConfig, result.startResult.ready
				? `✅ Minecraft restarted successfully in **${seconds}s**.`
				: `⚠️ Minecraft was relaunched in **${seconds}s**, but RCON readiness was not confirmed.`);
			await processQueue();
		} catch (error) {
			console.error(`[Minecraft Scheduler ${target}] Restart failed:`, error);
			await notifyChannel(client, serverConfig, `❌ Scheduled Minecraft restart failed: ${error.message}`);
		} finally {
			lease.release();
		}
	}, { noOverlap: true });

	let queueTimer = null;

	return {
		entry,
		processQueue,
		start() {
			tailer.start();
			if (serverConfig.scheduledRestart?.enabled === true) {
				warningTask.start();
				restartTask.start();
			}
			queueTimer = setInterval(() => {
				processQueue().catch(error => console.error('[Minecraft Whitelist] Queue processing failed:', error));
			}, options.queueIntervalMs || 30_000);
			queueTimer.unref?.();
			processQueue().catch(error => console.error('[Minecraft Whitelist] Initial queue processing failed:', error));
		},
		stop() {
			tailer.stop();
			warningTask.stop();
			restartTask.stop();
			if (queueTimer) clearInterval(queueTimer);
			if (scheduledLease) scheduledLease.release();
		},
		tailer,
		warningTask,
		restartTask,
	};
}

module.exports = {
	createMinecraftServices,
	formatWarning,
	getTextChannel,
	notifyChannel,
	secondsUntilNextFourHourRestart,
};
