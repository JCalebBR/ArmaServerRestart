const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { saveScoreboardBatch, checkExactDuplicate } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.db.name)
		.setDescription(strings.commands.db.desc),

	async execute(interaction) {
		// Defer ephemerally since this is a heavy admin task
		await interaction.deferReply({ ephemeral: true });

		const jsonDir = path.join(__dirname, '..', 'json');

		// 1. Verify the folder exists
		if (!fs.existsSync(jsonDir)) {
			return interaction.editReply(strings.errors.noFile('json'));
		}

		// 2. Read all files in the directory
		const files = fs.readdirSync(jsonDir).filter(file => file.endsWith('.json'));

		if (files.length === 0) {
			return interaction.editReply('📭 The `/json` folder is empty.');
		}

		await interaction.editReply(strings.ui.scanning(`${files.length} JSON files`));

		let totalFilesProcessed = 0;
		let totalRecordsAdded = 0;
		let totalDuplicatesSkipped = 0;

		// 3. Process each file
		for (const [index, file] of files.entries()) {
			try {
				// Read and parse the file
				const filePath = path.join(jsonDir, file);
				const fileContent = fs.readFileSync(filePath, 'utf-8');
				const parsedData = JSON.parse(fileContent);

				if (!Array.isArray(parsedData) || parsedData.length === 0) continue;

				// 4. Smart Filename Parsing
				let opDate = '1970-01-01';
				let opType = 'Unknown Operation';

				const match = file.match(/^(.*?)_(\d{4}-\d{2}-\d{2})(?:_(\d+))?\.json$/);

				if (match) {
					opType = match[1].replace(/_/g, ' ');
					opDate = match[2];

					// If a suffix exists (e.g., _2), append it to the Operation Type
					// This forces the database to treat it as a completely separate event
					if (match[3]) {
						opType += ` ${match[3]}`;
					}
				} else {
					console.warn(`⚠️ REGEX FAIL: "${file}" did not match the format. Defaulting to 1970-01-01.`);
				}
				// 5. Filter for Duplicates
				const newRecordsToSave = [];

				for (const player of parsedData) {
					const isDuplicate = checkExactDuplicate(opDate, opType, player);

					if (isDuplicate) {
						totalDuplicatesSkipped++;
					} else {
						newRecordsToSave.push(player);
					}
				}

				// 6. Save the unique records to the database
				if (newRecordsToSave.length > 0) {
					saveScoreboardBatch(newRecordsToSave, opDate, opType);
					totalRecordsAdded += newRecordsToSave.length;
				}
				if (index % 10 === 0) {
					await interaction.editReply({ content: strings.ui.processing(file, index + 1, files.length), components: [] });
				}
				totalFilesProcessed++;

			} catch (err) {
				console.error(`Failed to process file ${file}:`, err);
			}
		}

		// 7. Build the summary embed
		const embed = new EmbedBuilder()
			.setTitle('📦 Database Update Complete')
			.setColor(0x00FF00)
			.setDescription(`Successfully processed the \`/json\` directory.`)
			.addFields(
				{ name: '📄 Files Scanned', value: `${totalFilesProcessed} files`, inline: true },
				{ name: '💾 New Records Saved', value: `${totalRecordsAdded} records`, inline: true },
				{ name: '🛑 Duplicates Skipped', value: `${totalDuplicatesSkipped} records`, inline: true },
			);

		return interaction.editReply({ content: null, embeds: [embed] });
	},
};