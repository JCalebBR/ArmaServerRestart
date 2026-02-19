// commands/utility/checkreply.js
const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { analyzePbo, buildReportEmbed } = require('../utils/mission-parser');
const strings = require('../utils/strings');

module.exports = {
	data: new ContextMenuCommandBuilder()
		.setName(strings.commands.checkreply.name)
		.setType(ApplicationCommandType.Message),

	async execute(interaction) {
		// Get the message the user Right-Clicked on
		const targetMessage = interaction.targetMessage;

		// Find the first PBO attachment
		const attachment = targetMessage.attachments.find(att => att.name.toLowerCase().endsWith('.pbo'));

		if (!attachment) {
			return interaction.reply({
				content: strings.errors.noFile('pbo'),
				ephemeral: true,
			});
		}

		const fileName = attachment.name;
		await interaction.deferReply();


		const pboPath = path.join(os.tmpdir(), fileName);

		try {
			await interaction.editReply();
			const response = await fetch(attachment.url);
			if (!response.ok) throw new Error(strings.errors.downloadFail(response.statusText));
			const fileStream = fs.createWriteStream(pboPath);
			await pipeline(response.body, fileStream);

			await interaction.editReply(strings.ui.reading(fileName));
			const results = await analyzePbo(pboPath);

			// Re-use the Embed Builder logic (Ensure you copy the helper function below or export it)
			const embed = buildReportEmbed(fileName, results);

			await interaction.editReply({ content: null, embeds: [embed] });

		} catch (error) {
			console.error(error);
			await interaction.editReply({ content: strings.errors.genericError(error), embeds: [] });
		} finally {
			if (fs.existsSync(pboPath)) fs.unlinkSync(pboPath);
		}
	},
};