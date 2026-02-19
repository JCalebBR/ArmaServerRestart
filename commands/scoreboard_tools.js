const {
	ContextMenuCommandBuilder,
	ApplicationCommandType,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	EmbedBuilder,
	AttachmentBuilder,
} = require('discord.js');

// Import your existing DRY utilities
const { getLocalOperationDate, getDayOfWeekAndType } = require('../utils/dateHelper');
const { extractAndCleanScoreboardData } = require('../utils/scoreboardParser');
const { buildOpTypeSelect, buildActionButtons, buildDateModal } = require('../utils/uiComponents');
const strings = require('../utils/strings');

// --- UPDATED: Imported saveScoreboardBatch and getOperationScoreboard ---
const {
	renamePlayer,
	getPlayerOperationRecord,
	updatePlayerOperationRecord,
	saveScoreboardBatch,
	getOperationScoreboard,
} = require('../utils/db');

module.exports = {
	data: new ContextMenuCommandBuilder()
		.setName('Scoreboard Tools')
		.setType(ApplicationCommandType.Message),

	async execute(interaction) {
		const targetMessage = interaction.targetMessage;

		// 1. Build the Main Menu Buttons
		const btnProcessScoreboard = new ButtonBuilder()
			.setCustomId('btn_process_scoreboard')
			.setLabel('✅ Process Scoreboard')
			.setStyle(ButtonStyle.Success);

		const btnMultiJson = new ButtonBuilder()
			.setCustomId('btn_multi_post_json')
			.setLabel('⏬ Multi -> JSON')
			.setStyle(ButtonStyle.Secondary);

		const btnBatchJson = new ButtonBuilder()
			.setCustomId('btn_batch_json')
			.setLabel('🔗 Batch -> JSON')
			.setStyle(ButtonStyle.Secondary);

		const btnBatchMultiJson = new ButtonBuilder()
			.setCustomId('btn_batch_multi_json')
			.setLabel('📚 Batch Multi -> JSON')
			.setStyle(ButtonStyle.Danger);

		const components = [btnProcessScoreboard, btnMultiJson, btnBatchJson, btnBatchMultiJson];

		// Add Corrections Button ONLY if a thread exists
		if (targetMessage.hasThread) {
			const btnCorrections = new ButtonBuilder()
				.setCustomId('btn_run_corrections')
				.setLabel('🔧 Run Corrections')
				.setStyle(ButtonStyle.Primary);
			components.push(btnCorrections);
		}

		const row = new ActionRowBuilder().addComponents(...components);

		const responseMessage = await interaction.reply({
			content: '⚙️ **Scoreboard Tools:** What would you like to do with this message?',
			components: [row],
			ephemeral: false,
		});

		const collector = responseMessage.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60_000,
		});

		collector.on('collect', async i => {
			if (i.user.id !== interaction.user.id) {
				return i.reply({ content: strings.errors.notYourMenu, ephemeral: false });
			}

			if (i.customId === 'btn_process_scoreboard') {
				await i.update({ content: '⏳ Parsing images and preparing database import...', components: [] });

				const attachments = Array.from(targetMessage.attachments.values())
					.filter(att => att.contentType && att.contentType.startsWith('image/'))
					.slice(0, 5);

				await handleProcessScoreboardFlow(i, attachments, targetMessage);

			} else if (i.customId === 'btn_multi_post_json') {
				await i.update({ content: '⏳ Scanning message chain for images...', components: [] });
				const channel = targetMessage.channel;
				const collectedAttachments = [];

				const initialImages = Array.from(targetMessage.attachments.values())
					.filter(att => att.contentType && att.contentType.startsWith('image/'));
				if (initialImages.length > 0) collectedAttachments.push(...initialImages);

				const fetchedMessages = await channel.messages.fetch({ limit: 10, after: targetMessage.id });
				const chronologicalMessages = Array.from(fetchedMessages.values())
					.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

				for (const msg of chronologicalMessages) {
					const msgImages = Array.from(msg.attachments.values())
						.filter(att => att.contentType && att.contentType.startsWith('image/'));

					if (msgImages.length === 0) break;
					collectedAttachments.push(...msgImages);
				}

				await i.update({ content: `🔎 Found ${collectedAttachments.length} image(s) in this message chain.`, components: [] });
				await handleProcessScoreboardFlow(i, collectedAttachments, targetMessage);

			} else if (i.customId === 'btn_batch_json') {
				await i.update({ content: '⏳ Batch parsing links from this message...', components: [] });
				await handleBatchFlow(i, targetMessage, interaction.client, false);

			} else if (i.customId === 'btn_batch_multi_json') {
				await i.update({ content: '⏳ Batch processing link chains...', components: [] });
				await handleBatchFlow(i, targetMessage, interaction.client, true);
			}
			else if (i.customId === 'btn_run_corrections') {
				await i.update({ content: '⏳ Parsing corrections from thread and generating final JSON...', components: [] });
				await handleCorrectionsFlow(i, targetMessage, interaction.client);
			}
		});

		collector.on('end', collected => {
			if (collected.size === 0) interaction.editReply({ content: '⏳ Menu timed out.', components: [] });
		});
	},
};

// ==========================================
// WORKFLOW 1: PROCESS SCOREBOARD & IMPORT
// ==========================================
async function handleProcessScoreboardFlow(interaction, attachments, targetMessage) {
	try {
		if (attachments.length === 0) return interaction.editReply({ content: strings.errors.noImages || '❌ No valid images found.' });

		await interaction.editReply({ content: `⏳ Extracting data from ${attachments.length} image(s)...`, components: [] });
		const cleanedData = await extractAndCleanScoreboardData(attachments);

		if (cleanedData.length === 0) {
			return interaction.editReply({ content: strings.errors.claudeFail('Failed to extract any valid players from the images.') });
		}

		let opDate, opType, dayOfWeek = 'Thread Info';

		// --- NEW: Sync Import Details with Thread Title ---
		// We force the DB import to exactly match the thread title so Run Corrections can find it later.
		if (targetMessage.hasThread) {
			const titleParts = targetMessage.thread.name.split(': ');
			if (titleParts.length === 2) {
				opType = titleParts[0].trim();
				opDate = titleParts[1].trim();
			}
		}

		// Fallback to dateHelper only if there is no thread attached
		if (!opType || !opDate) {
			opDate = getLocalOperationDate(targetMessage.createdAt);
			const updatedInfo = getDayOfWeekAndType(opDate);
			dayOfWeek = updatedInfo.dayOfWeek;
			opType = updatedInfo.opType;
		}

		const buildEmbed = () => {
			return new EmbedBuilder()
				.setTitle('📋 Confirm Database Import Details')
				.setColor(0xFFA500)
				.setDescription(`Claude parsed **${cleanedData.length}** players from **${attachments.length}** image(s).\n\nPlease verify the Operation Type and Date before inserting this into the Live Database.`)
				.addFields(
					{ name: strings.ui.editDateBtn, value: `\`${opDate}\`\n(*${dayOfWeek}*)`, inline: true },
					{ name: strings.ui.selectType, value: `\`${opType}\``, inline: true },
				);
		};

		const buildComponents = () => {
			return [buildOpTypeSelect(opType), buildActionButtons('Import to Database')];
		};

		const responseMessage = await interaction.editReply({ content: null, embeds: [buildEmbed()], components: buildComponents() });
		const collector = responseMessage.createMessageComponentCollector({ time: 300_000 });

		collector.on('collect', async i => {
			if (i.user.id !== interaction.user.id) return i.reply({ content: strings.errors.notYourMenu, ephemeral: true });

			if (i.isStringSelectMenu() && i.customId === 'select_op_type') {
				opType = i.values[0];
				await i.update({ embeds: [buildEmbed()], components: buildComponents() });
			}

			if (i.isButton()) {
				if (i.customId === 'btn_cancel') {
					collector.stop();
					return i.update({ content: '🚫 Database import cancelled.', embeds: [], components: [] });
				}

				if (i.customId === 'btn_confirm') {
					collector.stop();
					await i.update({ content: `⏳ Importing ${cleanedData.length} records into the database...`, embeds: [], components: [] });

					try {
						// --- NEW: Keep Thread Name Synced ---
						// If the admin changed the date or type using the UI, rename the thread
						// so that "Run Corrections" doesn't break later!
						if (targetMessage.hasThread) {
							const expectedThreadName = `${opType}: ${opDate}`;
							if (targetMessage.thread.name !== expectedThreadName) {
								try {
									await targetMessage.thread.setName(expectedThreadName);
								} catch (err) {
									console.warn('Failed to rename thread to match import details:', err);
								}
							}
						}

						// Directly insert into SQLite
						saveScoreboardBatch(cleanedData, opDate, opType);

						try { await targetMessage.react('💾'); } catch (reactErr) { }

						return interaction.editReply({
							content: `✅ **Import Successful!**\n\n**Next Steps:**\n1. Run the \`/cleandb\` command to apply rename rules and remove bad names.\n2. Apply player corrections in the thread.\n3. Use the **Run Corrections** button to finalize and generate the JSON backup.`
						});

					} catch (dbError) {
						console.error('Database Insertion Error:', dbError);
						return interaction.editReply({ content: `❌ Failed to insert data into the database: \`${dbError.message}\`` });
					}
				}

				if (i.customId === 'btn_edit_date') {
					const modal = buildDateModal(opDate);
					await i.showModal(modal);

					try {
						const modalSubmit = await i.awaitModalSubmit({ time: 60_000, filter: mi => mi.user.id === interaction.user.id && mi.customId === 'modal_date' });
						opDate = modalSubmit.fields.getTextInputValue('input_date');
						const updatedInfo = getDayOfWeekAndType(opDate);
						dayOfWeek = updatedInfo.dayOfWeek;
						opType = updatedInfo.opType;

						await modalSubmit.update({ embeds: [buildEmbed()], components: buildComponents() });
					} catch (err) { console.warn('Modal submission error:', err); }
				}
			}
		});

	} catch (error) {
		console.error(error);
		await interaction.editReply({ content: strings.errors.genericError({ message: `An error occurred: ${error.message}` }), embeds: [], components: [] });
	}
}

// ==========================================
// WORKFLOW 2: RUN CORRECTIONS & EXPORT JSON
// ==========================================
async function handleCorrectionsFlow(interaction, targetMessage, client) {
	try {
		const thread = targetMessage.thread;

		const titleParts = thread.name.split(': ');
		if (titleParts.length !== 2) {
			return interaction.editReply({ content: '❌ Could not parse Operation Type and Date from the thread title. Ensure it is formatted like `Main Operation: YYYY-MM-DD`.' });
		}

		const opType = titleParts[0].trim();
		const dbDate = titleParts[1].trim();

		if (!/^\d{4}-\d{2}-\d{2}$/.test(dbDate)) {
			return interaction.editReply({ content: '❌ Invalid date format in thread title. Expected `YYYY-MM-DD`.' });
		}

		const messages = await thread.messages.fetch({ limit: 100 });
		const messagesArray = Array.from(messages.values()).reverse();
		let renamesApplied = 0;
		let deathDiscountsApplied = 0;
		const failedDiscounts = [];

		const renameRegex = /Rename:\s*["']([^"']+)["']\s*["']([^"']+)["']/i;
		const deathRegex = /Death discount:\s*(\d+)/i;

		for (const msg of messagesArray) {
			if (msg.author.bot) continue;

			const content = msg.content;

			const renameMatch = content.match(renameRegex);
			if (renameMatch) {
				const oldName = renameMatch[1].trim();
				const newName = renameMatch[2].trim();
				const changes = renamePlayer(oldName, newName);
				if (changes > 0) {
					renamesApplied++;
					await msg.react('✅');
				}
			}

			const deathMatch = content.match(deathRegex);
			if (deathMatch) {
				const discountAmount = parseInt(deathMatch[1], 10);

				let member = msg.member;
				if (!member) {
					try { member = await thread.guild.members.fetch(msg.author.id); } catch (err) {
						console.warn('Failed to fetch member from thread:', err);
					}
				}

				const rawDiscordName = member?.nickname || member?.displayName || msg.author.displayName || msg.author.username;

				const cleanDiscordName = rawDiscordName
					.replace(/\s*\([^)]*\)/g, '')
					.replace(/[^\w\s']/g, '')
					.replace(/\bBT\b/g, '')
					.trim()
					.replace(/\s+/g, ' ');

				const record = getPlayerOperationRecord(dbDate, opType, cleanDiscordName);

				if (record) {
					const newDeaths = Math.max(0, record.deaths - discountAmount);

					const changes = updatePlayerOperationRecord(record.id, {
						inf_kills: record.inf_kills,
						soft_veh: record.soft_veh,
						armor_veh: record.armor_veh,
						air: record.air,
						score: record.score,
						deaths: newDeaths,
					});

					if (changes > 0) {
						await msg.react('✅');
						deathDiscountsApplied++;
					};
				} else {
					failedDiscounts.push(cleanDiscordName);
				}
			}
		}

		// --- NEW: Fetch Corrected Data and Backup to JSON ---
		const finalScoreboardData = getOperationScoreboard(dbDate, opType);

		const prettyJson = JSON.stringify(finalScoreboardData, null, 4);
		const fileBuffer = Buffer.from(prettyJson, 'utf-8');
		const safeOpType = opType.replace(/\s+/g, '_');
		const fileName = `${safeOpType}_${dbDate}.json`;
		const jsonAttachment = new AttachmentBuilder(fileBuffer, { name: fileName });

		let backupStatus = '';
		try {
			const targetChannel = await client.channels.fetch(process.env.CHANNEL_ID);
			await targetChannel.send({
				content: `📂 **Final Corrected Data** for **${opType}** on **${dbDate}**`,
				files: [jsonAttachment],
			});
			backupStatus = `\n✅ Final JSON safely backed up to <#${process.env.CHANNEL_ID}>.`;
		} catch (backupErr) {
			console.error('Failed to send backup JSON:', backupErr);
			backupStatus = `\n⚠️ Corrections applied, but failed to send JSON backup to the designated channel.`;
		}

		// Build summary
		const embed = new EmbedBuilder()
			.setTitle('🔧 Corrections Applied & Backed Up')
			.setColor(0x00FF00)
			.setDescription(`Successfully processed thread instructions and exported final database snapshot.` + backupStatus)
			.addFields(
				{ name: '👤 Renames Processed', value: `${renamesApplied}`, inline: true },
				{ name: '💀 Deaths Discounted', value: `${deathDiscountsApplied}`, inline: true },
			);

		if (failedDiscounts.length > 0) {
			embed.addFields({
				name: '⚠️ Failed Discounts (No DB Record Found)',
				value: failedDiscounts.map(n => `• ${n}`).join('\n').substring(0, 1024),
			});
		}

		await interaction.editReply({ content: null, embeds: [embed] });

		try { await targetMessage.react('✅'); } catch (e) { }

	} catch (error) {
		console.error(error);
		await interaction.editReply({ content: strings.errors.genericError({ message: `Failed to process corrections: ${error.message}` }) });
	}
}

// ==========================================
// HELPER 2: UNIFIED BATCH LOGIC
// ==========================================
// Incorporates your `entries()` and specific status messages
async function handleBatchFlow(interaction, targetMessage, client, isMultiPost) {
	// [Kept exactly the same to preserve your existing functionality]
	try {
		const content = targetMessage.content;
		const linkRegex = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(?<guildId>\d+|@me)\/(?<channelId>\d+)\/(?<messageId>\d+)/gi;
		const matches = [...content.matchAll(linkRegex)];

		if (matches.length === 0) return interaction.editReply({ content: '❌ No Discord message links were found in that message.' });

		await interaction.editReply(`🔄 Found ${matches.length} message link(s).`);

		const successFiles = [];
		const failedLinks = [];

		let targetChannel;
		try {
			targetChannel = await client.channels.fetch(process.env.CHANNEL_ID);
		} catch (err) {
			return interaction.editReply({ content: strings.errors.genericError({ message: 'Could not fetch the target upload channel (process.env.CHANNEL_ID).' }) });
		}

		for (const [index, match] of matches.entries()) {
			const link = match[0];
			const channelId = match.groups.channelId;
			const messageId = match.groups.messageId;

			try {
				const channel = await client.channels.fetch(channelId);
				const msg = await channel.messages.fetch(messageId);

				const collectedAttachments = [];

				const initialImages = Array.from(msg.attachments.values())
					.filter(att => att.contentType && att.contentType.startsWith('image/'));

				if (initialImages.length > 0) collectedAttachments.push(...initialImages);

				if (isMultiPost) {
					const fetchedMessages = await channel.messages.fetch({ limit: 10, after: msg.id });
					const chronologicalMessages = Array.from(fetchedMessages.values())
						.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

					for (const subMsg of chronologicalMessages) {
						const subImages = Array.from(subMsg.attachments.values())
							.filter(att => att.contentType && att.contentType.startsWith('image/'));

						if (subImages.length === 0) break;
						collectedAttachments.push(...subImages);
					}
				}

				const attachmentsToProcess = isMultiPost ? collectedAttachments : collectedAttachments.slice(0, 5);

				if (attachmentsToProcess.length === 0) throw new Error("No image attachments found on this message sequence.");

				await interaction.editReply({ content: `🔎 Found ${attachmentsToProcess.length} image(s) in message #${index + 1}.`, components: [] });

				const cleanedData = await extractAndCleanScoreboardData(attachmentsToProcess);

				if (cleanedData.length === 0) throw new Error(strings.errors.claudeFail('Failed to extract any valid players from the images.'));

				const opDate = getLocalOperationDate(msg.createdAt);
				const { opType } = getDayOfWeekAndType(opDate);

				const safeOpType = opType.replace(/\s+/g, '_');
				let fileName = `${safeOpType}_${opDate}.json`;

				const duplicateCount = successFiles.filter(f => f.baseName === `${safeOpType}_${opDate}`).length;
				if (duplicateCount > 0) {
					fileName = `${safeOpType}_${opDate}_${duplicateCount + 1}.json`;
				}

				const prettyJson = JSON.stringify(cleanedData, null, 4);
				const fileBuffer = Buffer.from(prettyJson, 'utf-8');
				const jsonAttachment = new AttachmentBuilder(fileBuffer, { name: fileName });

				await targetChannel.send({
					content: `📂 Raw JSON Data for **${opType}** on **${opDate}** (Batch Export${isMultiPost ? ' - Multi-Post' : ''})`,
					files: [jsonAttachment],
				});

				successFiles.push({ baseName: `${safeOpType}_${opDate}`, fileName, link });
				try { await msg.react('✅'); } catch (reactErr) {
					console.error('Failed to react:', reactErr);
				}

			} catch (error) {
				console.error(`Failed on link ${link}:`, error);
				failedLinks.push({ link, reason: error.message });
			}
		}

		const embed = new EmbedBuilder()
			.setTitle('📋 Batch Parse Results')
			.setColor(failedLinks.length === 0 ? 0x00FF00 : (successFiles.length === 0 ? 0xFF0000 : 0xFFA500))
			.addFields(
				{ name: '✅ Successful Parses', value: `${successFiles.length}`, inline: true },
				{ name: '❌ Failed Parses', value: `${failedLinks.length}`, inline: true },
			);

		if (successFiles.length > 0) {
			const successList = successFiles.map(s => `• \`${s.fileName}\``).join('\n');
			embed.addFields({ name: 'Uploaded Files', value: successList.length > 1024 ? successList.substring(0, 1020) + '...' : successList });
		}

		if (failedLinks.length > 0) {
			const errorList = failedLinks.map(f => `**Link:** [Jump to Message](${f.link})\n**Reason:** \`${f.reason}\``).join('\n\n');
			embed.addFields({ name: 'Failed Links Details', value: errorList.length > 1024 ? errorList.substring(0, 1020) + '...' : errorList });
		}

		await interaction.editReply({
			content: `✅ Batch process complete! Files were sent directly to <#${process.env.CHANNEL_ID}>.`,
			embeds: [embed],
		});

	} catch (error) {
		console.error(error);
		await interaction.editReply({ content: strings.errors.genericError({ message: `An error occurred in batch logic: ${error.message}` }) });
	}
}