const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	EmbedBuilder,
	SlashCommandBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');
const { findAllArmaProcesses } = require('../utils/server');
const { tryAcquireMaintenanceOperation } = require('../utils/operationCoordinator');
const {
	discoverWorkshopMods,
	fetchWorkshopTitles,
	formatDuration,
	mirrorWorkshopItem,
	paginateLines,
	readModMeta,
	runSteamCmd,
	workshopItemsMatch,
} = require('../utils/steamWorkshop');

const CONFIG_PATH = path.join(__dirname, '../servers.json');
const REPORT_COLLECTOR_TIME = 300_000;

function loadWorkshopConfig() {
	const fullConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
	const config = fullConfig.steamWorkshop;

	if (!config || !config.steamCmdPath || !config.username || !config.stagingDirectory || !config.appId) {
		throw new Error('The steamWorkshop section in servers.json is incomplete.');
	}
	if (config.username.includes('<')) {
		throw new Error('Set steamWorkshop.username in servers.json before using this command.');
	}
	if (!fs.existsSync(config.steamCmdPath)) {
		throw new Error(`SteamCMD was not found at ${config.steamCmdPath}.`);
	}
	if (!fs.existsSync(config.stagingDirectory)) {
		throw new Error(`The mod staging directory was not found at ${config.stagingDirectory}.`);
	}

	return config;
}

function cleanTitle(title, workshopId) {
	const fallback = `Workshop item ${workshopId}`;
	if (!title || typeof title !== 'string') return fallback;
	const cleaned = title.replace(/[\r\n]+/g, ' ').trim();
	return cleaned ? cleaned.slice(0, 180) : fallback;
}

function cacheDirectoryFor(config, workshopId) {
	return path.join(
		config.stagingDirectory,
		'steamapps',
		'workshop',
		'content',
		String(config.appId),
		workshopId,
	);
}

function createProgressEmbed(index, total, title, workshopId) {
	return new EmbedBuilder()
		.setColor(0xF2C94C)
		.setTitle('🔄 Updating Steam Workshop Mods')
		.setDescription(`Updating **${index} out of ${total} mods**\n\n**${title}**\nWorkshop ID: \`${workshopId}\``)
		.setTimestamp();
}

function reportLines(updated, failures, total) {
	const lines = [];

	if (updated.length === 0 && failures.length === 0) {
		return [`✅ All **${total}** mods were already up to date.`];
	}

	if (updated.length > 0) {
		lines.push('**Updated mods**');
		for (const mod of updated) lines.push(`• **${mod.title}** (\`${mod.id}\`)`);
	} else {
		lines.push('✅ No mods required updates.');
	}

	if (failures.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('**Failed mods**');
		for (const failure of failures) {
			lines.push(`• **${failure.title}** (\`${failure.id}\`) — ${failure.reason}`);
		}
	}

	return lines;
}

function buildReportEmbeds(updated, failures, total, elapsed) {
	const pages = paginateLines(reportLines(updated, failures, total));
	const color = failures.length > 0 ? 0xF2994A : 0x27AE60;

	return pages.map((description, index) => new EmbedBuilder()
		.setColor(color)
		.setTitle(`📦 Mod Update Report — ${updated.length}/${total} Updated`)
		.setDescription(description)
		.addFields(
			{ name: 'Total', value: String(total), inline: true },
			{ name: 'Updated', value: String(updated.length), inline: true },
			{ name: 'Failed', value: String(failures.length), inline: true },
		)
		.setFooter({ text: `Page ${index + 1} of ${pages.length} • Completed in ${elapsed}` })
		.setTimestamp());
}

function createReportButtons(page, totalPages) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId('update_report_previous')
			.setLabel(strings.ui.prevBtn)
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page === 0),
		new ButtonBuilder()
			.setCustomId('update_report_next')
			.setLabel(strings.ui.nextBtn)
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page === totalPages - 1),
	);
}

async function safeEditReply(interaction, payload) {
	try {
		await interaction.editReply(payload);
	} catch (error) {
		console.warn('[Workshop] Could not update the ephemeral progress message:', error.message);
	}
}

async function publishReport(interaction, embeds) {
	if (!interaction.channel || !interaction.channel.isTextBased()) {
		throw new Error('The update report could not be posted in this channel.');
	}

	let currentPage = 0;
	const components = embeds.length > 1 ? [createReportButtons(currentPage, embeds.length)] : [];
	const reportMessage = await interaction.channel.send({
		content: `<@${interaction.user.id}>`,
		embeds: [embeds[currentPage]],
		components,
		allowedMentions: { users: [interaction.user.id] },
	});

	if (embeds.length <= 1) return;

	const collector = reportMessage.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: REPORT_COLLECTOR_TIME,
	});

	collector.on('collect', async buttonInteraction => {
		if (buttonInteraction.user.id !== interaction.user.id) {
			return buttonInteraction.reply({ content: strings.errors.notYourMenu, ephemeral: true });
		}

		if (buttonInteraction.customId === 'update_report_previous') currentPage--;
		if (buttonInteraction.customId === 'update_report_next') currentPage++;
		currentPage = Math.max(0, Math.min(currentPage, embeds.length - 1));

		await buttonInteraction.update({
			embeds: [embeds[currentPage]],
			components: [createReportButtons(currentPage, embeds.length)],
		});
	});

	collector.on('end', () => {
		reportMessage.edit({ components: [] }).catch(error => {
			console.warn('[Workshop] Could not remove expired report buttons:', error.message);
		});
	});
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.update.name)
		.setDescription(strings.commands.update.desc),

	async execute(interaction) {
		const startedAt = Date.now();
		await interaction.deferReply({ ephemeral: true });

		const operationLease = tryAcquireMaintenanceOperation();
		if (!operationLease.acquired) {
			const message = operationLease.reason === 'server'
				? '⚠️ A server lifecycle operation is already running.'
				: '⚠️ A Steam Workshop update is already running.';
			return interaction.editReply(message);
		}

		try {
			let config;
			try {
				config = loadWorkshopConfig();
			} catch (error) {
				return interaction.editReply(`❌ ${error.message}`);
			}

			let runningProcesses;
			try {
				runningProcesses = await findAllArmaProcesses();
			} catch (error) {
				return interaction.editReply(`❌ ${error.message}`);
			}

			if (runningProcesses.length > 0) {
				return interaction.editReply('⚠️ Stop all Arma servers and headless clients before updating mods.');
			}

			let mods;
			try {
				mods = discoverWorkshopMods(config.stagingDirectory);
			} catch (error) {
				console.error('[Workshop] Could not scan the staging directory:', error);
				return interaction.editReply('❌ The mod staging directory could not be scanned.');
			}

			if (mods.length === 0) {
				return interaction.editReply('⚠️ No numeric Workshop-ID folders were found in the staging directory.');
			}

			const missingTitleIds = mods.filter(mod => !mod.meta.name).map(mod => mod.id);
			let remoteTitles = new Map();
			if (missingTitleIds.length > 0) {
				try {
					remoteTitles = await fetchWorkshopTitles(missingTitleIds);
				} catch (error) {
					console.warn('[Workshop] Could not retrieve missing mod titles:', error.message);
				}
			}

			const updated = [];
			const failures = [];

			for (let index = 0; index < mods.length; index++) {
				const mod = mods[index];
				let title = cleanTitle(mod.meta.name || remoteTitles.get(mod.id), mod.id);
				await safeEditReply(interaction, {
					embeds: [createProgressEmbed(index + 1, mods.length, title, mod.id)],
				});

				try {
					const processesBeforeDownload = await findAllArmaProcesses();
					if (processesBeforeDownload.length > 0) {
						const reason = 'An Arma process started during the update; this mod was not processed.';
						for (const remainingMod of mods.slice(index)) {
							failures.push({
								id: remainingMod.id,
								title: cleanTitle(remainingMod.meta.name || remoteTitles.get(remainingMod.id), remainingMod.id),
								reason,
							});
						}
						break;
					}
				} catch (error) {
					const reason = `The remaining mods were not processed: ${error.message}`.slice(0, 300);
					for (const remainingMod of mods.slice(index)) {
						failures.push({
							id: remainingMod.id,
							title: cleanTitle(remainingMod.meta.name || remoteTitles.get(remainingMod.id), remainingMod.id),
							reason,
						});
					}
					break;
				}

				try {
					await runSteamCmd(config, mod.id);
					const cachedDirectory = cacheDirectoryFor(config, mod.id);
					if (!fs.existsSync(cachedDirectory)) {
						throw new Error('SteamCMD did not create a Workshop cache folder.');
					}

					const cachedMeta = readModMeta(cachedDirectory);
					title = cleanTitle(cachedMeta.name || mod.meta.name || remoteTitles.get(mod.id), mod.id);
					if (workshopItemsMatch(mod.directory, cachedDirectory)) continue;

					const processesBeforeCopy = await findAllArmaProcesses();
					if (processesBeforeCopy.length > 0) {
						throw new Error('An Arma process started before the updated files could be applied.');
					}

					await mirrorWorkshopItem(config, mod.id);
					if (!workshopItemsMatch(mod.directory, cachedDirectory)) {
						throw new Error('The staging folder did not match the Workshop cache after copying.');
					}

					updated.push({ id: mod.id, title });
				} catch (error) {
					console.error(`[Workshop] Failed to update ${mod.id}:`, error);
					failures.push({ id: mod.id, title, reason: error.message.slice(0, 300) });
				}
			}

			const elapsed = formatDuration(Date.now() - startedAt);
			const embeds = buildReportEmbeds(updated, failures, mods.length, elapsed);
			try {
				await publishReport(interaction, embeds);
				await safeEditReply(interaction, {
					content: `✅ Update finished in **${elapsed}**. The public report has been posted.`,
					embeds: [],
					components: [],
				});
			} catch (error) {
				console.error('[Workshop] Could not publish the update report:', error);
				await safeEditReply(interaction, {
					content: `⚠️ Updating finished in **${elapsed}**, but the public report could not be posted: ${error.message}`,
					embeds: [embeds[0]],
					components: [],
				});
			}
		} finally {
			operationLease.release();
		}
	},

	_buildReportEmbeds: buildReportEmbeds,
	_loadWorkshopConfig: loadWorkshopConfig,
};
