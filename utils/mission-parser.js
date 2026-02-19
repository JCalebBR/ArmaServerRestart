// utils/mission-parser.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const HEMTT_PATH = '"C:\\HEMTT\\hemtt.exe"';

/**
 * Runs a shell command and captures stdout
 */
function runCommand(command, options = {}) {
	return new Promise((resolve, reject) => {
		exec(command, { maxBuffer: 1024 * 1024 * 50, ...options }, (error, stdout) => {
			if (error && (!stdout || stdout.trim().length === 0)) reject(error);
			resolve(stdout);
		});
	});
}

/**
 * Formats lists for Discord Embeds
 */
function formatList(items) {
	if (!items || items.length === 0) return "None";
	const total = items.length;
	const joined = items.join(', ');
	if (joined.length < 900) return `**(${total})** ${joined}`;
	let validStr = joined.substring(0, 900);
	validStr = validStr.substring(0, validStr.lastIndexOf(','));
	const remaining = total - validStr.split(',').length;
	return `**(${total})** ${validStr}, ... and **${remaining} more**`;
}

/**
 * Parses the SQM content string
 */
function parseSqm(content) {
	const extractClass = (className, fullText) => {
		const classRegex = new RegExp(`class\\s+${className}\\s*`, 'i');
		const match = fullText.match(classRegex);
		if (!match) return null;
		const startIndex = match.index + match[0].length;
		const openBraceIndex = fullText.indexOf('{', startIndex);
		if (openBraceIndex === -1) return null;
		let balance = 1;
		let currentIndex = openBraceIndex + 1;
		while (balance > 0 && currentIndex < fullText.length) {
			const char = fullText[currentIndex];
			if (char === '{') balance++;
			else if (char === '}') balance--;
			currentIndex++;
		}
		if (balance !== 0) return null;
		return fullText.substring(openBraceIndex + 1, currentIndex - 1);
	};

	const findValue = (key, text) => {
		if (!text) return null;
		const regex = new RegExp(`\\b${key}\\b\\s*=\\s*([\\s\\S]*?);`, 'i');
		const match = text.match(regex);
		if (!match) return null;
		return match[1].replace(/"/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
	};

	const extractArray = (key, text) => {
		if (!text) return [];
		const regex = new RegExp(`\\b${key}\\[\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`, 'i');
		const match = text.match(regex);
		if (!match) return [];
		const rawList = match[1];
		const items = [];
		const itemRegex = /"([^"]+)"/g;
		let itemMatch;
		while ((itemMatch = itemRegex.exec(rawList)) !== null) {
			items.push(itemMatch[1]);
		}
		return items;
	};

	// Extraction Logic
	const scenarioData = extractClass('ScenarioData', content);
	const editorData = extractClass('EditorData', content);
	const missionClass = extractClass('Mission', content);
	const missionIntel = extractClass('Intel', missionClass || content);

	// Fallback MP Check
	const customAttributes = extractClass('CustomAttributes', scenarioData || "");
	let hasMultiplayerAttr = /name\s*=\s*"Multiplayer"/i.test(customAttributes || "");
	if (!hasMultiplayerAttr) {
		hasMultiplayerAttr = /name\s*=\s*"Multiplayer"/i.test(content);
	}

	return {
		hasAuthor: !!findValue('author', scenarioData),
		author: findValue('author', scenarioData),
		hasTitle: !!findValue('briefingName', missionIntel),
		title: findValue('briefingName', missionIntel),
		aiDisabled: findValue('disabledAI', scenarioData) === '1',
		// Composition check
		hasComposition: ['BT Ship Comp', 'BT Spawn Comp'].some(c => new RegExp(`name\\s*=\\s*"${c}"`, 'i').test(content)),
		edenMods: extractArray('mods', editorData),
		requiredAddons: extractArray('addons', content).filter(addon => !addon.startsWith('A3_')),
		respawn: findValue('respawn', scenarioData),
		respawnDelay: findValue('respawnDelay', scenarioData),
		validRespawn: findValue('respawn', scenarioData) === '3',
		validRespawnDelay: findValue('respawnDelay', scenarioData) === '5',
		hasMultiplayerAttr,
	};
}

/**
 * Main Worker: Unpacks PBO and returns analysis results
 */
async function analyzePbo(pboPath) {
	const tempDir = os.tmpdir();
	const unpackDir = path.join(tempDir, `unpack_${Date.now()}_${Math.random().toString(36).slice(2)}`);

	// Target files
	const derapSqmPath = path.join(unpackDir, 'mission.derap.sqm');
	const stdSqmPath = path.join(unpackDir, 'mission.sqm');

	try {
		// Ensure clean slate
		if (fs.existsSync(unpackDir)) fs.rmSync(unpackDir, { recursive: true, force: true });

		// Unpack
		await runCommand(`${HEMTT_PATH} utils pbo unpack -r "${pboPath}" "${unpackDir}"`);

		// Find file
		let finalSqmPath = null;
		if (fs.existsSync(derapSqmPath)) finalSqmPath = derapSqmPath;
		else if (fs.existsSync(stdSqmPath)) finalSqmPath = stdSqmPath;
		else throw new Error("mission.sqm not found after unpacking.");

		// Read & Parse
		const content = fs.readFileSync(finalSqmPath, 'utf8');
		return parseSqm(content);

	} finally {
		// Always cleanup unpack folder
		if (fs.existsSync(unpackDir)) {
			try { fs.rmSync(unpackDir, { recursive: true, force: true }); } catch (e) {
				console.error(e);
			}
		}
	}
}

function buildReportEmbed(fileName, results) {
	const isNamingValid = /^([\w-]+)\.([\w-]+)\.pbo$/i.test(fileName);

	const embed = new EmbedBuilder().setTitle(`📋 Mission Check: ${fileName}`).setTimestamp();

	const criticalFail = !isNamingValid || !results.aiDisabled || !results.hasComposition ||
		!results.validRespawn || !results.validRespawnDelay || !results.hasMultiplayerAttr;
	const hasWarnings = !results.hasAuthor || !results.hasTitle;

	if (criticalFail) {
		embed.setColor(0xFF0000).setDescription('**❌ Failed**').setFooter({ text: 'Mission is not valid!' });
	} else if (hasWarnings) {
		embed.setColor(0xFFA500).setDescription('**⚠️ Passed with warnings**').setFooter({ text: 'Check warnings.' });
	} else {
		embed.setColor(0x00FF00).setDescription('**✅ Passed all checks**').setFooter({ text: 'Ready for upload.' });
	}

	embed.addFields(
		{ name: 'File Format', value: isNamingValid ? `✅` : '❌', inline: true },
		{ name: 'AI Disabled', value: results.aiDisabled ? '✅ Disabled' : '❌ **Active**', inline: true },
		{ name: 'Compositions', value: results.hasComposition ? `✅ Found` : '❌ **None**', inline: true },
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

module.exports = { analyzePbo, formatList, buildReportEmbed };