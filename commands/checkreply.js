// commands/utility/checkreply.js
const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { analyzePbo, formatList } = require('../utils/mission-parser');

module.exports = {
	data: new ContextMenuCommandBuilder()
		.setName('Check PBO')
		.setType(ApplicationCommandType.Message),

	async execute(interaction) {
		// Get the message the user Right-Clicked on
		const targetMessage = interaction.targetMessage;

		// Find the first PBO attachment
		const attachment = targetMessage.attachments.find(att => att.name.toLowerCase().endsWith('.pbo'));

		if (!attachment) {
			return interaction.reply({
				content: '❌ That message does not have a valid **.pbo** file attached.',
				ephemeral: true,
			});
		}

		const fileName = attachment.name;
		await interaction.deferReply();

		// --- REUSE LOGIC ---
		// (This part is identical to the main command, thanks to the util!)
		const pboPath = path.join(os.tmpdir(), fileName);

		try {
			await interaction.editReply(`📥 Downloading **${fileName}** from message...`);
			const response = await fetch(attachment.url);
			if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
			const fileStream = fs.createWriteStream(pboPath);
			await pipeline(response.body, fileStream);

			await interaction.editReply(`📦 Reading PBO...`);
			const results = await analyzePbo(pboPath);

			// Re-use the Embed Builder logic (Ensure you copy the helper function below or export it)
			const embed = buildReportEmbed(fileName, results);

			await interaction.editReply({ content: null, embeds: [embed] });

		} catch (error) {
			console.error(error);
			await interaction.editReply({ content: `❌ Error: ${error.message}`, embeds: [] });
		} finally {
			if (fs.existsSync(pboPath)) fs.unlinkSync(pboPath);
		}
	},
};

// Copy the 'buildReportEmbed' function here from check.js
// (or better yet, put 'buildReportEmbed' in 'utils/mission-parser.js' too and import it!)
function buildReportEmbed(fileName, results) {
	const isNamingValid = /^([\w-]+)\.([\w-]+)\.pbo$/i.test(fileName);

	const embed = new EmbedBuilder().setTitle(`📋 Mission Check: ${fileName}`).setTimestamp();

	const criticalFail = !isNamingValid || !results.aiDisabled || !results.hasComposition ||
		!results.validRespawn || !results.validRespawnDelay || !results.hasMultiplayerAttr;
	const hasWarnings = !results.hasAuthor || !results.hasTitle;

	if (criticalFail) {
		embed.setColor(0xFF0000).setDescription('**❌ FAILED CRITICAL CHECKS**').setFooter({ text: 'Mission is not valid!' });
	} else if (hasWarnings) {
		embed.setColor(0xFFA500).setDescription('**⚠️ PASSED WITH WARNINGS**').setFooter({ text: 'Check warnings.' });
	} else {
		embed.setColor(0x00FF00).setDescription('**✅ PASSED ALL CHECKS**').setFooter({ text: 'Ready for upload.' });
	}

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
	return embed;
}