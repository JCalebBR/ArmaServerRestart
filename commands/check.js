// commands/utility/check.js
const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { analyzePbo, buildReportEmbed } = require('../utils/mission-parser');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.check.name)
		.setDescription(strings.commands.check.desc)
		.addAttachmentOption(option =>
			option.setName(strings.commands.check.args.first.name)
				.setDescription(strings.commands.check.args.first.desc)
				.setRequired(true),
		),

	async execute(interaction) {
		const attachment = interaction.options.getAttachment('file');
		const fileName = attachment.name;

		if (!fileName.toLowerCase().endsWith('.pbo')) {
			return interaction.reply({ content: strings.errors.invalidFile('.pbo'), ephemeral: true });
		}

		await interaction.deferReply();

		const pboPath = path.join(os.tmpdir(), fileName);

		try {
			// Download
			await interaction.editReply(strings.ui.downloading(fileName));
			const response = await fetch(attachment.url);
			if (!response.ok) throw new Error(strings.errors.downloadFail(response.statusText));
			const fileStream = fs.createWriteStream(pboPath);
			await pipeline(response.body, fileStream);

			// Analyze (Using Shared Utility)
			await interaction.editReply(strings.ui.reading(fileName));
			const results = await analyzePbo(pboPath);

			// Build Report (Shared Logic for Embed)
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