// fix-scores.js
const fs = require('fs');
const path = require('path');

// ⚠️ CHANGE THIS to the folder where your JSON files are saved
const JSON_FOLDER_PATH = path.join(__dirname, 'json');

function fixJsonScores() {
	console.log(`📂 Scanning directory: ${JSON_FOLDER_PATH}`);

	// Read all files in the directory
	fs.readdir(JSON_FOLDER_PATH, (err, files) => {
		if (err) {
			return console.error('❌ Unable to scan directory:', err);
		}

		// Filter for only .json files
		const jsonFiles = files.filter(file => file.endsWith('.json'));

		if (jsonFiles.length === 0) {
			return console.log('⚠️ No JSON files found in this directory.');
		}

		let totalFilesFixed = 0;
		let totalPlayersFixed = 0;

		jsonFiles.forEach(file => {
			const filePath = path.join(JSON_FOLDER_PATH, file);

			try {
				// 1. Read and parse the JSON file
				const rawData = fs.readFileSync(filePath, 'utf8');
				const parsedData = JSON.parse(rawData);

				let fileModified = false;

				// 2. Loop through players and recalculate
				parsedData.forEach(player => {
					const correctScore =
						(player.inf_kills * 1) +
						(player.soft_veh * 2) +
						(player.armor_veh * 3) +
						(player.air * 5);

					// If the AI got it wrong, update it
					if (player.score !== correctScore) {
						player.score = correctScore;
						fileModified = true;
						totalPlayersFixed++;
					}
				});

				// 3. If we changed anything, overwrite the file with the new data
				if (fileModified) {
					fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 4), 'utf8');
					console.log(`✅ Fixed scores in: ${file}`);
					totalFilesFixed++;
				} else {
					console.log(`➖ No fixes needed for: ${file}`);
				}

			} catch (error) {
				console.error(`❌ Error processing file ${file}:`, error.message);
			}
		});

		console.log('\n🎉 --- SCRUB COMPLETE --- 🎉');
		console.log(`Modified ${totalFilesFixed} files.`);
		console.log(`Corrected the math for ${totalPlayersFixed} individual players.`);
	});
}

fixJsonScores();