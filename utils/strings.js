module.exports = {
	// 🛑 GLOBAL ERRORS
	errors: {
		genericError: (error) => `❌ Error: ${error.message}`,
		noImages: '❌ No valid images found on this message.',
		dbFetchFail: '❌ Failed to fetch data from the database.',
		emptyDb: '📭 The database is currently empty.',
		downloadFail: (errorCode) => `❌ Download failed. ${errorCode}`,
		notYourMenu: '🚫 You cannot interact with this menu.',
		noFile: (fileType) => `❌ No **${fileType}** found.`,
		invalidFile: (fileType) => `❌ Invalid file. Only **${fileType}** files are allowed.`,
		claudeFail: (err) => `❌ Claude encountered an error: ${err}`,
		noRecords: (targetPlayer) => `📭 No records found for **${targetPlayer}**.`,
	},

	// 🎛️ SHARED UI Text
	ui: {
		prevBtn: '◀ Previous',
		nextBtn: 'Next ▶',
		deleteBtn: '🗑️ Delete',
		confirmDelete: '⚠️ Are you sure you want to delete this?',
		editBtn: '📝 Edit',
		confirmBtn: '💾 Save',
		exportBtn: '✅ Export',
		cancelBtn: '🚫Cancel',
		editDateBtn: '📝 Date',
		modalTitle: '📝 Operation Date',
		selectType: '🏷️ Operation Type',
		downloading: (fileName) => `📥 Downloading **${fileName}**...`,
		processing: (fileName, index, count) => `💭 (${index}/${count}) Processing **${fileName}**...`,
		reading: (fileName) => `📖 Reading **${fileName}**...`,
		streak: {
			title: (count) => `🔥 Current Streak: ${count} Operations`,
			none: '*No active streak. Missed the last operation.*',
			hiddenCount: (count) => `\n*...and ${count} older operations.*`,
		},
		attendanceMonth: (month, count, total, percent) => `** └ ${month}:** ${count} out of ${total} ops (${percent}%)`,
		sortNames: {
			inf_kills: '🪖 Infantry',
			soft_veh: '🚗 Soft Veh.',
			armor_veh: '🚚 Armoured Veh.',
			air: '✈️ Air Veh.',
			deaths: '💀 Deaths',
			score: '∑ Score',
		},
		scanning: (count) => `🔎 Scanning ${count} records(s)...`,
		statsFooter: { text: `🪖: Infantry Kills | 🚗: Soft Veh. Kills | 🚚: Armoured Veh. Kills\n ✈️: Air Veh. Kills | 💀: Deaths | ∑: Combined Score` },
	},

	saveCommand: {
		processingImages: (count) => `✂️ Processing and parsing ${count} image(s)...`,
		confirmDetailsTitle: '📋 Confirm Import Details',
		confirmDetailsDesc: (count, source) => `Successfully parsed **${count}** players from ${source}.\nPlease verify the metadata before saving.`,
		savingData: (count) => `💾 Saving ${count} players to the database...`,
		success: (count, type, date) => `✅ **Success!** Saved ${count} players for **${type}** on **${date}**.`,
	},

	stats: {
		infantry: '🪖 Infantry',
		softVeh: '🚗 Soft Vehicles',
		armorVeh: '🚚 Armoured',
		air: '✈️ Air Kills',
		deaths: '💀 Deaths',
		score: '∑ Score',
	},

	commands: {
		attendance: {
			name: "attendance",
			desc: "View a detailed month-by-month attendance breakdown for a specific player.",
			args: {
				first: {
					name: 'player',
					desc: 'The player to look up',
				},
			},
		},
		backup: {
			name: "backup",
			desc: "Download all JSON archives from the logging channel to a local folder.",
		},
		check: {
			name: "check",
			desc: "Validates a PBO mission file",
			args: {
				first: {
					name: 'file',
					desc: 'The .pbo file to check',
				},
			},
		},
		checkreply: {
			name: "Check Mission File",
			desc: "Validates a PBO mission file",
		},
		cleandb: {
			name: "cleandb",
			desc: "Fix known name typos using the rename.json dictionary",
		},
		compare: {
			name: "compare",
			desc: "Put two players head-to-head to compare their all-time service records.",
		},
		db: {
			name: "db",
			desc: "'Bulk import all JSON files from the local /json folder into the database.'",
		},
		delete: {
			name: "delete",
			desc: "Permanently deletes a mission file from the server",
			args: {
				first: {
					name: 'mission',
					desc: 'The file to delete',
				},
			},
		},
		deleteplayer: {
			name: "deleteplayer",
			desc: "Permanently delete all records of a specific player from the database.",
			args: {
				first: {
					name: 'target_name',
					desc: 'The exact name of the player to delete',
				},
			},
		},
		inactive: {
			name: "inactive",
			desc: "Check for players who have not attended an operation recently.",
			args: {
				first: {
					name: 'days',
					desc: 'Number of days inactive (Defaults to 30)',
				},
			},
		},
		missions: {
			name: "missions",
			desc: "Lists all .pbo mission files on the server",
		},
		operation: {
			name: "operation",
			desc: "Search and view scoreboards from past operations.",
			args: {
				first: {
					name: 'target',
					desc: 'Search by date (YYYY-MM-DD) or operation type',
				},
			},
		},
		players: {
			name: "players",
			desc: "List all unique player names currently saved in the database.",
		},
		records: {
			name: "records",
			desc: "View all-time individual records and total global unit statistics.",
		},
		reload: {
			name: "reload",
			desc: "Reloads a command from the local file system.",
			args: {
				first: {
					name: 'command',
					desc: 'The command to reload',
				},
			},
		},
		rename: {
			name: "rename",
			desc: "Fix a typo in a player's name across all database records.",
			args: {
				first: {
					name: 'old_name',
					desc: 'The incorrect name currently in the database',
				},
				second: {
					name: 'new_name',
					desc: 'The correct name to change it to',
				},
			},
		},
		restart: {
			name: "restart",
			desc: "Restarts Server AND Headless Clients",
			args: {
				first: {
					name: 'server',
					desc: 'The server to restart',
				},
			},
		},
		scoreboard_image_db: {
			name: "Scoreboard (Image -> DB)",
			desc: "",
		},
		scoreboard_image_json: {
			name: "Scoreboard (Image -> JSON)",
			desc: "",
		},
		scoreboard_json_db: {
			name: "Scoreboard (JSON -> DB)",
			desc: "",
		},
		scoreboard: {
			name: "scoreboard",
			desc: "View the all-time unit scoreboard and stats",
			args: {
				first: {
					name: 'player',
					desc: 'Search for a specific player',
				},
			},
		},
		scoreboardedit: {
			name: "scoreboardedit",
			desc: "Manually correct a player's stats for a specific operation.",
			args: {
				first: {
					name: 'operation',
					desc: 'Search by date or type',
				},
				second: {
					name: 'player',
					desc: 'The player to edit',
				},
			},
		},
		scoreboardmonth: {
			name: "scoreboardmonth",
			desc: "View the unit scoreboard for a specific month.",
			args: {
				first: {
					name: 'month',
					desc: 'Select the month (Defaults to current month)',
				},
				second: {
					name: 'year',
					desc: 'Enter the year, e.g., 2026 (Defaults to current year)',
				},
			},
		},
		scoreboardyear: {
			name: "scoreboardyear",
			desc: "View the unit scoreboard for an entire year.",
			args: {
				first: {
					name: 'year',
					desc: 'Enter the year, e.g., 2026 (Defaults to current year)',
				},
			},
		},
		start: {
			name: "start",
			desc: "Boots up a server",
			args: {
				first: {
					name: 'server',
					desc: 'The server to start',
				},
			},
		},
		status: {
			name: "status",
			desc: "Checks the status of a server",
			args: {
				first: {
					name: 'server',
					desc: 'The server to check',
				},
			},
		},
		stop: {
			name: "stop",
			desc: "Shuts down a Server and its Headless Clients",
			args: {
				first: {
					name: 'server',
					desc: 'The server to stop',
				},
			},
		},
		upload: {
			name: "upload",
			desc: "Uploads a .pbo mission file to the server",
			args: {
				first: {
					name: 'file',
					desc: 'The .pbo file to upload',
				},
			},
		},
		uploadreply: {
			name: "Upload Mission File",
			desc: "Uploads a .pbo mission file to the server",
			args: {
				first: {
					name: 'file',
					desc: 'The .pbo file to upload',
				},
			},
		},
	},
};