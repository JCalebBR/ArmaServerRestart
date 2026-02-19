const { db } = require('./utils/db');

const fixDbScores = db.prepare(`
    UPDATE scoreboards
    SET score = (inf_kills * 1) + (soft_veh * 2) + (armor_veh * 3) + (air * 5)
    WHERE score != (inf_kills * 1) + (soft_veh * 2) + (armor_veh * 3) + (air * 5)
`);

const info = fixDbScores.run();
console.log(`🔧 Fixed ${info.changes} incorrect scores currently sitting in the database!`);