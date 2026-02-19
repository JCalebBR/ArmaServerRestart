const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');


const { renamePlayer, recalculateAllScores, getAllPlayerNames, deletePlayer } = require('../utils/db');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.cleandb.name)
		.setDescription(strings.commands.cleandb.desc),

	async execute(interaction) {
		await interaction.deferReply({ ephemeral: true });

		const renamePath = path.join(__dirname, '..', 'rename.json');
		const blacklistPath = path.join(__dirname, '..', 'blacklist.json');

		if (!fs.existsSync(renamePath)) {
			return interaction.editReply(strings.errors.noFile('rename.json'));
		}

		let renameData;
		try {
			renameData = JSON.parse(fs.readFileSync(renamePath, 'utf-8'));
		} catch (error) {
			console.error('JSON Parse Error:', error);
			return interaction.editReply(strings.errors.genericError({ message: 'Failed to parse `rename.json`.' }));
		}

		if (typeof renameData !== 'object' || Array.isArray(renameData)) {
			return interaction.editReply(strings.errors.genericError({ message: '`rename.json` must be a dictionary object.' }));
		}

		let blacklist = [];
		if (fs.existsSync(blacklistPath)) {
			try {
				blacklist = JSON.parse(fs.readFileSync(blacklistPath, 'utf-8')).map(w => w.toLowerCase());
			} catch (error) {
				console.error('Blacklist Parse Error:', error);
				return interaction.editReply(strings.errors.genericError({ message: 'Failed to parse `blacklist.json`. Ensure it is a valid JSON array of strings.' }));
			}
		}

		await interaction.editReply(strings.ui.scanning('typo dictionary, invalid names, and checking math'));

		let typosChecked = 0;
		let rowsFixed = 0;
		let namesCorrected = 0;

		for (const [incorrectName, correctName] of Object.entries(renameData)) {
			typosChecked++;
			try {
				const changes = renamePlayer(incorrectName, correctName);
				if (changes > 0) {
					rowsFixed += changes;
					namesCorrected++;
				}
			} catch (error) {
				console.error(`Error renaming ${incorrectName} to ${correctName}:`, error);
			}
		}

		let invalidNamesPurged = 0;
		let invalidRowsDeleted = 0;

		try {
			const allPlayers = getAllPlayerNames();

			for (const row of allPlayers) {
				const name = row.player_name;
				if (!name) continue;

				// Split by spaces (apostrophes stay attached to the word)
				const words = name.trim().split(/\s+/);
				let shouldDelete = false;

				if (/\d/.test(name)) { shouldDelete = true; }
				else if (words.length === 1) { shouldDelete = true; }
				else if (words.length > 2) { shouldDelete = true; }
				else {
					const nameLower = name.toLowerCase();
					for (const bannedWord of blacklist) {
						if (nameLower.includes(bannedWord)) {
							shouldDelete = true;
							break;
						}
					}
				}

				if (shouldDelete) {
					const deletedRows = deletePlayer(name);
					if (deletedRows > 0) {
						invalidNamesPurged++;
						invalidRowsDeleted += deletedRows;
					}
				}
			}
		} catch (error) {
			console.error('Error purging invalid names:', error);
		}

		// 5. Fix Mathematical Hallucinations
		let mathErrorsFixed = 0;
		try {
			mathErrorsFixed = recalculateAllScores();
		} catch (error) {
			console.error('Error recalculating scores:', error);
		}

		// 6. Build a clean summary embed
		const embed = new EmbedBuilder()
			.setTitle('🔧 Database Maintenance Complete')
			.setColor(0x00FF00)
			.setDescription(`Successfully processed the rename dictionary, purged invalid names, and verified all scoreboard math.`)
			.addFields(
				{ name: '📖 Dictionary Size', value: `${typosChecked} known typos`, inline: true },
				{ name: '👤 Players Corrected', value: `${namesCorrected} names fixed`, inline: true },
				{ name: '💾 Total Rows Merged', value: `${rowsFixed} operations updated`, inline: true },
				{ name: '🚫 Invalid Names Purged', value: `${invalidNamesPurged} players deleted`, inline: true },
				{ name: '🗑️ Total Rows Deleted', value: `${invalidRowsDeleted} records removed`, inline: true },
				{ name: '🧮 Math Errors Fixed', value: `${mathErrorsFixed} scores recalculated`, inline: false },
			);

		if (rowsFixed === 0 && mathErrorsFixed === 0 && invalidRowsDeleted === 0) {
			embed.setFooter({ text: 'Database is perfectly clean! No typos, no invalid names, and all math is correct.' });
		} else {
			embed.setFooter({ text: 'All stats for corrected players have been merged and invalid entries removed.' });
		}

		return interaction.editReply({ content: null, embeds: [embed] });
	},
};