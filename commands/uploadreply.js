const {
	ContextMenuCommandBuilder,
	ApplicationCommandType,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const strings = require('../utils/strings');

const { analyzePbo, formatList } = require('../utils/mission-parser');

// --- CONFIGURATION ---
const UPLOAD_DESTINATION = 'C:\\Games\\ArmaA3\\mpmissions\\';

module.exports = {
	data: new ContextMenuCommandBuilder()
		.setName(strings.commands.uploadreply.name)
		.setType(ApplicationCommandType.Message),

	async execute(interaction) {
		console.log("▶️ Upload Reply: Command started.");

		const targetMessage = interaction.targetMessage;
		const attachment = targetMessage.attachments.find(att => att.name.toLowerCase().endsWith('.pbo'));

		if (!attachment) {
			return interaction.reply({
				content: strings.errors.noFile('pbo'),
				ephemeral: true,
			});
		}

		const fileName = attachment.name;
		await interaction.deferReply();

		// Paths
		const tempPboPath = path.join(os.tmpdir(), fileName);
		const finalPboPath = path.join(UPLOAD_DESTINATION, fileName);

		try {
			// 1. DOWNLOAD TO TEMP
			await interaction.editReply(strings.ui.downloading(fileName));
			let response = await fetch(attachment.url);
			if (!response.ok) throw new Error(strings.errors.downloadFail(response.statusText));
			const fileStream = fs.createWriteStream(tempPboPath);
			await pipeline(response.body, fileStream);

			// 2. VALIDATE
			await interaction.editReply(`🔎 Validating PBO...`);
			const results = await analyzePbo(tempPboPath);

			const isNamingValid = /^([\w-]+)\.([\w-]+)\.pbo$/i.test(fileName);
			const criticalFail = !isNamingValid || !results.aiDisabled || !results.hasComposition ||
				!results.validRespawn || !results.validRespawnDelay || !results.hasMultiplayerAttr;
			const hasWarnings = !results.hasAuthor || !results.hasTitle;

			// 3. REJECT IF INVALID
			if (criticalFail) {
				fs.unlinkSync(tempPboPath);

				const embed = new EmbedBuilder()
					.setTitle(`❌ Upload Rejected: ${fileName}`)
					.setColor(0xFF0000)
					.setDescription('**Mission failed critical checks.**\nThe file was **NOT** uploaded.')
					.setFooter({ text: 'Fix the errors below and try again.' })
					.setTimestamp();

				addReportFields(embed, isNamingValid, results);
				return interaction.editReply({ content: null, embeds: [embed] });
			}

			// 4. CHECK FOR CONFLICT
			if (fs.existsSync(finalPboPath)) {
				// --- CONFLICT HANDLING ---
				const confirmButton = new ButtonBuilder()
					.setCustomId('confirm')
					.setLabel(strings.ui.confirmBtn)
					.setStyle(ButtonStyle.Danger);

				const cancelButton = new ButtonBuilder()
					.setCustomId('cancel')
					.setLabel(strings.ui.cancelBtn)
					.setStyle(ButtonStyle.Secondary);

				const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

				response = await interaction.editReply({
					content: `⚠️ **${fileName}** already exists on the server.\nIt passed validation. Do you want to overwrite it?`,
					components: [row],
					embeds: [],
				});

				const collector = response.createMessageComponentCollector({
					componentType: ComponentType.Button,
					time: 15_000,
				});

				collector.on('collect', async i => {
					if (i.user.id !== interaction.user.id) {
						return i.reply({ content: '🚫 You cannot control this upload.', ephemeral: true });
					}

					if (i.customId === 'confirm') {
						// User clicked Overwrite
						await i.update({ content: `🔄 Overwriting **${fileName}**...`, components: [] });

						try {
							finalizeUpload(tempPboPath, finalPboPath, fileName, hasWarnings, isNamingValid, results, i);
						} catch (error) {
							console.error(error);
							await i.editReply(`❌ Upload failed: ${error.message}`);
						}
					} else {
						// User clicked Cancel
						fs.unlinkSync(tempPboPath);
						await i.update({ content: '🚫 Upload cancelled.', components: [] });
					}
				});

				collector.on('end', collected => {
					if (collected.size === 0) {
						if (fs.existsSync(tempPboPath)) fs.unlinkSync(tempPboPath);
						interaction.editReply({ content: '⏳ Timed out. Upload cancelled.', components: [] });
					}
				});
				return;
			}

			await interaction.editReply(`🚀 Uploading to server...`);
			await finalizeUpload(tempPboPath, finalPboPath, fileName, hasWarnings, isNamingValid, results, interaction);

		} catch (error) {
			console.error(error);
			await interaction.editReply({ content: `❌ Error: ${error.message}`, embeds: [] });
			if (fs.existsSync(tempPboPath)) fs.unlinkSync(tempPboPath);
		}
	},
};

async function finalizeUpload(source, dest, fileName, hasWarnings, isNamingValid, results, interactionOrButton) {
	if (!fs.existsSync(UPLOAD_DESTINATION)) {
		throw new Error(`Server folder not found: ${UPLOAD_DESTINATION}`);
	}

	// Move file (Copy + Delete Temp)
	fs.copyFileSync(source, dest);
	fs.unlinkSync(source);

	const embed = new EmbedBuilder()
		.setTitle(`✅ Upload Successful: ${fileName}`)
		.setColor(0x00FF00)
		.setDescription(hasWarnings
			? '**Mission passed (with warnings) and was uploaded.**'
			: '**Mission passed all checks and was uploaded.**')
		.setFooter({ text: 'Ready to play!' })
		.setTimestamp();

	addReportFields(embed, isNamingValid, results);

	// If it's a button interaction, we use editReply, otherwise normal editReply
	await interactionOrButton.editReply({ content: null, embeds: [embed] });
}

function addReportFields(embed, isNamingValid, results) {
	embed.addFields(
		{ name: 'File Format', value: isNamingValid ? `✅ Correct` : '❌ **INVALID**', inline: true },
		{ name: 'AI Disabled', value: results.aiDisabled ? '✅ Yes' : '❌ **ACTIVE**', inline: true },
		{ name: 'Compositions', value: results.hasComposition ? `✅ Found` : '❌ **NONE**', inline: true },
		{ name: 'Author', value: results.hasAuthor ? `✅ ${results.author}` : '⚠️ **Missing**', inline: true },
		{ name: 'Title', value: results.hasTitle ? `✅ ${results.title}` : '⚠️ **Missing**', inline: true },
		{ name: '\u200B', value: '\u200B', inline: false },
		{ name: 'Respawn Type', value: results.validRespawn ? `✅ BASE (3)` : `❌ **${results.respawn || 'Missing'}** (Need 3)`, inline: true },
		{ name: 'Respawn Delay', value: results.validRespawnDelay ? `✅ 5s` : `❌ **${results.respawnDelay || 'Missing'}** (Need 5)`, inline: true },
		{ name: 'MP Attribute', value: results.hasMultiplayerAttr ? `✅ Enabled` : `❌ **Missing**`, inline: true },
		{ name: 'Eden Mods', value: formatList(results.edenMods), inline: false },
		{ name: 'Required Addons', value: formatList(results.requiredAddons), inline: false },
	);
}