const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { pipeline } = require('stream/promises');

// --- CONFIGURATION ---
const HEMTT_PATH = '"C:\\HEMTT\\hemtt.exe"';

module.exports = {
	data: new SlashCommandBuilder()
		.setName('check')
		.setDescription('Uploads and validates a PBO mission file')
		.addAttachmentOption(option =>
			option.setName('file')
				.setDescription('The .pbo file to check')
				.setRequired(true),
		),

	async execute(interaction) {
		const attachment = interaction.options.getAttachment('file');
		const fileName = attachment.name;

		if (!fileName.toLowerCase().endsWith('.pbo')) {
			return interaction.reply({ content: '❌ File must be a **.pbo**.', ephemeral: true });
		}

		await interaction.deferReply();

		const tempDir = os.tmpdir();
		const pboPath = path.join(tempDir, fileName);
		const extractFolderName = path.parse(fileName).name;
		const extractPath = path.join(tempDir, extractFolderName);

		try {
			await interaction.editReply(`📥 Downloading **${fileName}**...`);
			const response = await fetch(attachment.url);
			if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
			const fileStream = fs.createWriteStream(pboPath);
			await pipeline(response.body, fileStream);

			await interaction.editReply(`📦 Reading with HEMTT...`);
			const sqmContent = await runCommand(`${HEMTT_PATH} utils pbo extract "${pboPath}" "mission.sqm"`);

			// --- RUN CHECKS ---
			const results = checkSqmContent(sqmContent);

			// --- BUILD REPORT ---
			const embed = new EmbedBuilder()
				.setTitle(`📋 Mission Check: ${fileName}`)
				.setTimestamp();

			const criticalFail = !results.hasAuthor || !results.hasTitle || !results.aiDisabled || !results.hasComposition;

			if (criticalFail) {
				embed.setColor(0xFF0000).setDescription('**❌ Failed Critical Checks**').setFooter({ text: 'Mission is not valid!' });
			} else {
				embed.setColor(0x00FF00).setDescription('**✅ Passed All Requirements**').setFooter({ text: 'Mission is valid! Ready for upload.' });
			}

			// Standard Fields
			embed.addFields(
				{ name: 'Author', value: results.hasAuthor ? `✅ ${results.author}` : '❌ Missing', inline: true },
				{ name: 'Title', value: results.hasTitle ? `✅ ${results.title}` : '❌ Missing', inline: true },
				{ name: 'Overview', value: results.hasOverview ? `ℹ️ Present` : '⚠️ Missing', inline: true },
				{ name: 'AI Disabled', value: results.aiDisabled ? '✅ Yes' : '❌ **ACTIVE**', inline: true },
				{ name: 'Compositions', value: results.hasComposition ? `✅ Found: "${results.foundComp}"` : '❌ **NONE**', inline: true },
			);

			// --- NEW: MODS SECTIONS ---

			// Helper to format long lists safely
			const formatList = (items) => {
				if (!items || items.length === 0) return "None";
				const total = items.length;
				const joined = items.join(', ');

				// Discord field limit is 1024 chars. We cut off at 900 to be safe.
				if (joined.length < 900) return `**(${total})** ${joined}`;

				// If too long, cut it and add count
				let validStr = joined.substring(0, 900);
				// Cut to the last comma so we don't break a word
				validStr = validStr.substring(0, validStr.lastIndexOf(','));
				const remaining = total - validStr.split(',').length;
				return `**(${total})** ${validStr}, ... and **${remaining} more**`;
			};

			embed.addFields(
				{ name: 'Eden Mods (Editor)', value: formatList(results.edenMods), inline: false },
				{ name: 'Required Addons', value: formatList(results.requiredAddons), inline: false },
			);

			await interaction.editReply({ content: null, embeds: [embed] });

		} catch (error) {
			console.error(error);
			await interaction.editReply({ content: `❌ Error: ${error.message}`, embeds: [] });
		} finally {
			try {
				if (fs.existsSync(pboPath)) fs.unlinkSync(pboPath);
				if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
			} catch (e) { console.error("Cleanup error:", e); }
		}
	},
};

function runCommand(command) {
	return new Promise((resolve, reject) => {
		exec(command, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout) => {
			if (error && (!stdout || stdout.trim().length === 0)) reject(error);
			resolve(stdout);
		});
	});
}

// --- UPDATED PARSER ---
function checkSqmContent(content) {
	// 1. EXTRACT CLASS Helper
	const extractClass = (name, text) => {
		const regex = new RegExp(`class\\s+${name}\\s*\\{([\\s\\S]*?)\\};?`, 'i');
		const match = text.match(regex);
		return match ? match[1] : null;
	};

	// 2. FIND VALUE Helper
	const findValue = (key, text) => {
		if (!text) return null;
		const regex = new RegExp(`\\b${key}\\b\\s*=\\s*([\\s\\S]*?);`, 'i');
		const match = text.match(regex);
		if (!match) return null;
		return match[1].replace(/"/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
	};

	// 3. EXTRACT ARRAY Helper
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

	// --- EXECUTE EXTRACTION ---

	// Scopes
	const scenarioData = extractClass('ScenarioData', content);
	const editorData = extractClass('EditorData', content);
	const missionIntel = extractClass('Intel', content);

	// Values
	const author = findValue('author', scenarioData);
	const disabledAI = findValue('disabledAI', scenarioData);
	const overview = findValue('overviewText', scenarioData);
	const title = findValue('briefingName', missionIntel);

	// Arrays
	const edenMods = extractArray('mods', editorData);

	// FILTER: Remove vanilla 'A3_' addons
	const requiredAddons = extractArray('addons', content)
		.filter(addon => !addon.startsWith('A3_'));

	// Composition Check
	const requiredComps = ['BT Ship Comp', 'BT Spawn Comp'];
	let foundComp = null;
	for (const comp of requiredComps) {
		if (new RegExp(`name\\s*=\\s*"${comp}"`, 'i').test(content)) {
			foundComp = comp;
			break;
		}
	}

	return {
		hasAuthor: !!author, author,
		hasTitle: !!title, title,
		aiDisabled: disabledAI === '1',
		hasOverview: !!overview,
		hasComposition: !!foundComp, foundComp,
		edenMods,
		requiredAddons,
	};
}