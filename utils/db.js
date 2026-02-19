// utils/db.js (Updated Section)
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'unit_stats.db');
const db = new Database(dbPath);

// 1. Create table with new columns
db.prepare(`
	CREATE TABLE IF NOT EXISTS scoreboards (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		operation_date TEXT,
		operation_type TEXT,
		player_name TEXT,
		rank INTEGER,
		inf_kills INTEGER,
		soft_veh INTEGER,
		armor_veh INTEGER,
		air INTEGER,
		deaths INTEGER,
		score INTEGER
	)
`).run();

// 2. Updated insert statement
const insertScore = db.prepare(`
	INSERT INTO scoreboards (
		operation_date, operation_type, player_name, rank, inf_kills, soft_veh, armor_veh, air, deaths, score
	) VALUES (
		@op_date, @op_type, @name, @rank, @inf_kills, @soft_veh, @armor_veh, @air, @deaths, @score
	)
`);

// 3. Updated batch function
function saveScoreboardBatch(dataArray, opDate, opType) {
	const insertMany = db.transaction((data) => {
		for (const player of data) {
			insertScore.run({
				op_date: opDate,
				op_type: opType,
				name: player.name,
				rank: player.rank,
				inf_kills: player.inf_kills,
				soft_veh: player.soft_veh,
				armor_veh: player.armor_veh,
				air: player.air,
				deaths: player.deaths,
				score: player.score,
			});
		}
	});

	insertMany(dataArray);
}

function getAggregatedScoreboard() {
	const stmt = db.prepare(`
		SELECT 
			player_name as name, 
			SUM(inf_kills) as inf_kills, 
			SUM(soft_veh) as soft_veh, 
			SUM(armor_veh) as armor_veh, 
			SUM(air) as air, 
			SUM(deaths) as deaths, 
			SUM(score) as score,
            COUNT(DISTINCT operation_date || operation_type) as ops_attended
		FROM scoreboards
		GROUP BY player_name
	`);
	return stmt.all();
}

function getPlayerStats(playerName, currentMonthPrefix, currentYearPrefix) {
	const stmt = db.prepare(`
		SELECT 
			player_name as name,
			SUM(inf_kills) as inf_kills,
			SUM(soft_veh) as soft_veh,
			SUM(armor_veh) as armor_veh,
			SUM(air) as air,
			SUM(deaths) as deaths,
			SUM(score) as score,
			COUNT(id) as operations_attended,
			COALESCE(SUM(CASE WHEN operation_date LIKE ? THEN 1 ELSE 0 END), 0) as operations_this_month,
			COALESCE(SUM(CASE WHEN operation_date LIKE ? THEN 1 ELSE 0 END), 0) as operations_this_year
		FROM scoreboards
		WHERE player_name LIKE ?
		GROUP BY player_name
	`);

	return stmt.get(`${currentMonthPrefix}%`, `${currentYearPrefix}%`, `%${playerName}%`);
}

function searchPlayerNames(partialName) {
	const stmt = db.prepare(`
		SELECT DISTINCT player_name 
		FROM scoreboards 
		WHERE player_name LIKE ? 
		ORDER BY player_name ASC 
		LIMIT 25
	`);

	// Use % wildcards so typing "wolff" finds "Zacharia Wolff"
	return stmt.all(`%${partialName}%`);
}

function getRecentOperations() {
	// Fetches the 25 most recent unique operations
	const stmt = db.prepare(`
		SELECT DISTINCT operation_date, operation_type
		FROM scoreboards
		ORDER BY operation_date DESC
		LIMIT 25
	`);
	return stmt.all();
}

function getOperationScoreboard(opDate, opType) {
	// Fetches all players for a specific date and type, sorted by Score
	const stmt = db.prepare(`
		SELECT player_name as name, rank, inf_kills, soft_veh, armor_veh, air, deaths, score
		FROM scoreboards
		WHERE operation_date = ? AND operation_type = ?
		ORDER BY score DESC
	`);
	return stmt.all(opDate, opType);
}

function searchOperations(searchTerm) {
	// Searches both the date and the type for matches
	const stmt = db.prepare(`
		SELECT DISTINCT operation_date, operation_type
		FROM scoreboards
		WHERE operation_date LIKE ? OR operation_type LIKE ?
		ORDER BY operation_date DESC
		LIMIT 25
	`);

	// Use wildcards so typing "2026" or "Main" finds the right matches
	return stmt.all(`%${searchTerm}%`, `%${searchTerm}%`);
}

function getAllPlayerNames() {
	const stmt = db.prepare(`
		SELECT DISTINCT player_name 
		FROM scoreboards 
		ORDER BY player_name ASC
	`);
	return stmt.all();
}

function renamePlayer(oldName, newName) {
	const stmt = db.prepare(`
		UPDATE scoreboards 
		SET player_name = ? 
		WHERE player_name = ?
	`);
	const info = stmt.run(newName, oldName);

	// return info.changes tells us exactly how many rows were fixed!
	return info.changes;
}

function deletePlayer(playerName) {
	const stmt = db.prepare(`
		DELETE FROM scoreboards 
		WHERE player_name = ?
	`);
	const info = stmt.run(playerName);

	// Returns the number of rows that were deleted
	return info.changes;
}

function getPlayerOperationRecord(opDate, opType, playerName) {
	const stmt = db.prepare(`
		SELECT * FROM scoreboards
		WHERE operation_date = ? AND operation_type = ? AND player_name = ?
	`);
	return stmt.get(opDate, opType, playerName);
}

function updatePlayerOperationRecord(recordId, updates) {
	// COALESCE means "If the new value is null, keep the old value"
	const stmt = db.prepare(`
		UPDATE scoreboards
		SET inf_kills = COALESCE(@inf_kills, inf_kills),
			soft_veh = COALESCE(@soft_veh, soft_veh),
			armor_veh = COALESCE(@armor_veh, armor_veh),
			air = COALESCE(@air, air),
			deaths = COALESCE(@deaths, deaths),
			score = COALESCE(@score, score)
		WHERE id = @id
	`);

	// We pass the updates object directly into the run function
	const info = stmt.run({ ...updates, id: recordId });
	return info.changes;
}

function searchPlayersInOperation(opDate, opType, partialName) {
	const stmt = db.prepare(`
		SELECT player_name 
		FROM scoreboards 
		WHERE operation_date = ? AND operation_type = ? AND player_name LIKE ?
		ORDER BY player_name ASC
		LIMIT 25
	`);

	// We pass all three parameters, using wildcards ONLY for the name
	return stmt.all(opDate, opType, `%${partialName}%`);
}

function getAggregatedScoreboardByDate(datePrefix) {
	const stmt = db.prepare(`
		SELECT 
			player_name as name, 
			SUM(inf_kills) as inf_kills, 
			SUM(soft_veh) as soft_veh, 
			SUM(armor_veh) as armor_veh, 
			SUM(air) as air, 
			SUM(deaths) as deaths, 
			SUM(score) as score,
            COUNT(DISTINCT operation_date || operation_type) as ops_attended
		FROM scoreboards
		WHERE operation_date LIKE ? || '%'
		GROUP BY player_name
	`);
	return stmt.all(datePrefix);
}

function getHighestRecords() {
	const categories = ['inf_kills', 'soft_veh', 'armor_veh', 'air', 'deaths', 'score'];
	const records = {};

	for (const cat of categories) {
		// This query finds the single row with the highest number for each category
		const stmt = db.prepare(`
			SELECT player_name, operation_date, ${cat} as max_val 
			FROM scoreboards 
			ORDER BY ${cat} DESC 
			LIMIT 1
		`);
		records[cat] = stmt.get();
	}
	return records;
}

function getInactivePlayers(thresholdDateString) {
	const stmt = db.prepare(`
		SELECT player_name, MAX(operation_date) as last_seen 
		FROM scoreboards 
		GROUP BY player_name 
		HAVING MAX(operation_date) <= ? 
		ORDER BY last_seen ASC
	`);

	return stmt.all(thresholdDateString);
}

function checkExactDuplicate(opDate, opType, player) {
	const stmt = db.prepare(`
		SELECT 1 FROM scoreboards 
		WHERE operation_date = ? 
		  AND operation_type = ? 
		  AND player_name = ? 
		  AND inf_kills = ? 
		  AND soft_veh = ? 
		  AND armor_veh = ? 
		  AND air = ? 
		  AND deaths = ? 
		  AND score = ?
	`);

	const result = stmt.get(
		opDate,
		opType,
		player.name,
		player.inf_kills,
		player.soft_veh,
		player.armor_veh,
		player.air,
		player.deaths,
		player.score,
	);

	// Returns true if a perfect match is found, false if it's a new unique record
	return result !== undefined;
}

function getUnitRecords() {
	// 1. Get the absolute total of all stats combined
	const totalsStmt = db.prepare(`
		SELECT 
			SUM(inf_kills) as total_inf, 
			SUM(soft_veh) as total_soft, 
			SUM(armor_veh) as total_armor, 
			SUM(air) as total_air, 
			SUM(deaths) as total_deaths, 
			SUM(score) as total_score,
			COUNT(DISTINCT operation_date || operation_type) as total_ops
		FROM scoreboards
	`);
	const totals = totalsStmt.get();

	// 2. Find the operation with the MOST players (Fixed)
	const maxPlayersStmt = db.prepare(`
		SELECT operation_date, operation_type, COUNT(DISTINCT player_name) as player_count 
		FROM scoreboards 
		GROUP BY operation_date, operation_type 
		ORDER BY player_count DESC 
		LIMIT 1
	`);
	const maxPlayers = maxPlayersStmt.get();

	// 3. Find the operation with the LEAST players (Fixed)
	const minPlayersStmt = db.prepare(`
		SELECT operation_date, operation_type, COUNT(DISTINCT player_name) as player_count 
		FROM scoreboards 
		GROUP BY operation_date, operation_type 
		ORDER BY player_count ASC 
		LIMIT 1
	`);
	const minPlayers = minPlayersStmt.get();

	return { totals, maxPlayers, minPlayers };
}

function getPlayerAttendanceDetails(playerName) {
	const stmt = db.prepare(`
		SELECT 
			SUBSTR(operation_date, 1, 4) as year, 
			SUBSTR(operation_date, 6, 2) as month, 
			COUNT(*) as op_count
		FROM scoreboards
		WHERE player_name = ?
		GROUP BY year, month
		ORDER BY year DESC, month DESC
	`);

	return stmt.all(playerName);
}

function getAllOperationsChronological() {
	// We use DESC so the newest operations are at the top of the list
	const stmt = db.prepare(`
		SELECT DISTINCT operation_date, operation_type 
		FROM scoreboards 
		ORDER BY operation_date DESC
	`);
	return stmt.all();
}

function getPlayerOperationsChronological(playerName) {
	const stmt = db.prepare(`
		SELECT operation_date, operation_type 
		FROM scoreboards 
		WHERE player_name = ? 
		ORDER BY operation_date DESC
	`);
	return stmt.all(playerName);
}

function getUnitOperationsPerMonth() {
	// We use nested subqueries to mathematically deduce the true number of unit operations
	// by finding the maximum number of times any single player deployed on a specific date and type.
	const stmt = db.prepare(`
        SELECT 
            year, 
            month, 
            SUM(true_op_count) as total_ops
        FROM (
            SELECT 
                SUBSTR(operation_date, 1, 4) as year, 
                SUBSTR(operation_date, 6, 2) as month, 
                MAX(op_count) as true_op_count
            FROM (
                -- Step 1: Count how many times each player deployed to each specific date/type
                SELECT 
                    operation_date, 
                    operation_type, 
                    player_name, 
                    COUNT(*) as op_count
                FROM scoreboards
                GROUP BY operation_date, operation_type, player_name
            )
            -- Step 2: Find the highest player attendance count for that date/type
            GROUP BY operation_date, operation_type
        )
        -- Step 3: Sum those highest counts together for the final monthly total
        GROUP BY year, month
        ORDER BY year DESC, month DESC
    `);

	return stmt.all();
}

function getOperationsByDateRange(startDate, endDate) {
	const stmt = db.prepare(`
		SELECT 
            operation_date, 
            operation_type, 
            COUNT(DISTINCT player_name) as players
		FROM scoreboards
		WHERE operation_date >= ? AND operation_date <= ?
		GROUP BY operation_date, operation_type
		ORDER BY operation_date DESC
	`);

	return stmt.all(startDate, endDate);
}

function recalculateAllScores() {
	const stmt = db.prepare(`
		UPDATE scoreboards
		SET score = (inf_kills * 1) + (soft_veh * 2) + (armor_veh * 3) + (air * 5)
		WHERE score != (inf_kills * 1) + (soft_veh * 2) + (armor_veh * 3) + (air * 5)
	`);

	const info = stmt.run();
	return info.changes;
}

function getFamilyScoreboard(datePrefix = null) {
	let stmt;
	if (datePrefix) {
		// We fetch the RAW data instead of pre-aggregated data to count distinct ops
		stmt = db.prepare(`SELECT * FROM scoreboards WHERE operation_date LIKE ? || '%'`);
	} else {
		stmt = db.prepare(`SELECT * FROM scoreboards`);
	}

	const rawRows = datePrefix ? stmt.all(datePrefix) : stmt.all();
	const families = {};

	for (const row of rawRows) {
		const playerName = row.player_name || "";
		const nameParts = playerName.trim().split(' ');
		const lastName = nameParts.pop();

		if (!lastName) continue;

		if (!families[lastName]) {
			families[lastName] = {
				name: lastName,
				membersSet: new Set(),
				opsSet: new Set(),
				inf_kills: 0,
				soft_veh: 0,
				armor_veh: 0,
				air: 0,
				deaths: 0,
				score: 0,
			};
		}

		// Track unique humans and unique operations
		families[lastName].membersSet.add(playerName);
		families[lastName].opsSet.add(`${row.operation_date}|${row.operation_type}`);

		// Add stats
		families[lastName].inf_kills += row.inf_kills;
		families[lastName].soft_veh += row.soft_veh;
		families[lastName].armor_veh += row.armor_veh;
		families[lastName].air += row.air;
		families[lastName].deaths += row.deaths;
		families[lastName].score += row.score;
	}

	// Convert the object back into your clean array format
	return Object.values(families)
		.filter(f => f.membersSet.size > 1)
		.map(f => ({
			name: f.name,
			members: f.membersSet.size,
			ops_attended: f.opsSet.size,
			inf_kills: f.inf_kills,
			soft_veh: f.soft_veh,
			armor_veh: f.armor_veh,
			air: f.air,
			deaths: f.deaths,
			score: f.score,
		}));
}
// --- NEW: Group by First Name (Twins) ---
function getTwinScoreboard(datePrefix = null) {
	let stmt;
	if (datePrefix) {
		stmt = db.prepare(`SELECT * FROM scoreboards WHERE operation_date LIKE ? || '%'`);
	} else {
		stmt = db.prepare(`SELECT * FROM scoreboards`);
	}

	const rawRows = datePrefix ? stmt.all(datePrefix) : stmt.all();
	const twins = {};

	for (const row of rawRows) {
		const playerName = row.player_name || "";
		const nameParts = playerName.trim().split(' ');

		// Grab the VERY FIRST word (First Name) instead of the last!
		const firstName = nameParts.shift();

		if (!firstName) continue;

		if (!twins[firstName]) {
			twins[firstName] = {
				name: firstName,
				membersSet: new Set(),
				opsSet: new Set(),
				inf_kills: 0,
				soft_veh: 0,
				armor_veh: 0,
				air: 0,
				deaths: 0,
				score: 0,
			};
		}

		// Track unique humans and unique operations
		twins[firstName].membersSet.add(playerName);
		twins[firstName].opsSet.add(`${row.operation_date}|${row.operation_type}`);

		// Add stats
		twins[firstName].inf_kills += row.inf_kills;
		twins[firstName].soft_veh += row.soft_veh;
		twins[firstName].armor_veh += row.armor_veh;
		twins[firstName].air += row.air;
		twins[firstName].deaths += row.deaths;
		twins[firstName].score += row.score;
	}

	return Object.values(twins)
		.filter(t => t.membersSet.size > 1)
		.map(t => ({
			name: t.name,
			members: t.membersSet.size,
			ops_attended: t.opsSet.size,
			inf_kills: t.inf_kills,
			soft_veh: t.soft_veh,
			armor_veh: t.armor_veh,
			air: t.air,
			deaths: t.deaths,
			score: t.score,
		}));
}

function deleteOperation(opDate, opType) {
	const stmt = db.prepare(`
		DELETE FROM scoreboards 
		WHERE operation_date = ? AND operation_type = ?
	`);
	const info = stmt.run(opDate, opType);

	// Returns the number of player rows that were deleted
	return info.changes;
}

// --- TEMPORARY DATABASE CLEANUP ---
// This deletes names that are exactly '', null, or just empty spaces
const cleanupInfo = db.prepare(`
	DELETE FROM scoreboards 
	WHERE player_name = '' 
	OR player_name IS NULL 
	OR TRIM(player_name) = ''
`).run();

if (cleanupInfo.changes > 0) {
	console.log(`🧹 SUCCESS: Purged ${cleanupInfo.changes} blank ghost entries from the database!`);
}
// ----------------------------------

module.exports = {
	db,
	saveScoreboardBatch,
	getAggregatedScoreboard,
	getPlayerStats,
	searchPlayerNames,
	searchOperations,
	getRecentOperations,
	getOperationScoreboard,
	getAllPlayerNames,
	renamePlayer,
	deletePlayer,
	getPlayerOperationRecord,
	updatePlayerOperationRecord,
	searchPlayersInOperation,
	getAggregatedScoreboardByDate,
	getHighestRecords,
	getInactivePlayers,
	checkExactDuplicate,
	getUnitRecords,
	getPlayerAttendanceDetails,
	getAllOperationsChronological,
	getPlayerOperationsChronological,
	getUnitOperationsPerMonth,
	getOperationsByDateRange,
	recalculateAllScores,
	getFamilyScoreboard,
	getTwinScoreboard,
	deleteOperation,
};