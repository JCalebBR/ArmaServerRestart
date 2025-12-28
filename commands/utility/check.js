const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { pipeline } = require('stream/promises');

// --- CONFIGURATION ---
// Point this to your hemtt.exe
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

		// Setup Paths
		const tempDir = os.tmpdir();
		const pboPath = path.join(tempDir, fileName);
		const extractFolderName = path.parse(fileName).name;
		const extractPath = path.join(tempDir, extractFolderName);

		try {
			// 1. DOWNLOAD
			await interaction.editReply(`📥 Downloading **${fileName}**...`);
			const response = await fetch(attachment.url);
			if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
			const fileStream = fs.createWriteStream(pboPath);
			await pipeline(response.body, fileStream);

			// 2. READ & DECODE SQM
			await interaction.editReply(`📦 Reading with HEMTT...`);
			// We capture the output (stdout) instead of reading the file directly.
			const sqmContent = await runCommand(`${HEMTT_PATH} utils pbo extract "${pboPath}" "mission.sqm"`);

			// 3. RUN CHECKS (Using the decoded content)
			const results = checkSqmContent(sqmContent);

			// 4. BUILD REPORT
			const embed = new EmbedBuilder()
				.setTitle(`📋 Mission Check: ${fileName}`)
				.setTimestamp();

			const criticalFail = !results.hasAuthor || !results.hasTitle || !results.aiDisabled || !results.hasComposition;

			if (criticalFail) {
				embed.setColor(0xFF0000).setDescription('**❌ Failed Critical Checks**').setFooter({ text: 'Mission is not valid!' });
			} else {
				embed.setColor(0x00FF00).setDescription('**✅ Passed All Requirements**').setFooter({ text: 'Mission is valid!. /upload it to the server!' });
			}

			embed.addFields(
				{ name: 'Author', value: results.hasAuthor ? `✅ ${results.author}` : '❌', inline: true },
				{ name: 'Title', value: results.hasTitle ? `✅ ${results.title}` : '❌', inline: true },
				{ name: 'Overview', value: results.hasOverview ? `ℹ️ Present` : '⚠️', inline: true },
				{ name: 'AI Disabled', value: results.aiDisabled ? '✅' : '❌', inline: true },
				{ name: 'Compositions', value: results.hasComposition ? `✅ Found: "${results.foundComp}"` : '❌', inline: false },
			);

			await interaction.editReply({ content: null, embeds: [embed] });

		} catch (error) {
			console.error(error);
			await interaction.editReply({ content: `❌ Error: ${error.message}`, embeds: [] });
		} finally {
			// 6. CLEANUP
			try {
				if (fs.existsSync(pboPath)) fs.unlinkSync(pboPath);
				if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
			} catch (e) {
				console.error("Cleanup error:", e);
			}
		}
	},
};

// --- HELPER: Promisified Exec ---
function runCommand(command) {
	return new Promise((resolve, reject) => {
		exec(command, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout) => {
			if (error) {
				// Warning: HEMTT might output to stderr even on success sometimes, or vice versa.
				// If stdout is empty and error exists, reject.
				if (!stdout || stdout.trim().length === 0) reject(error);
			}
			resolve(stdout);
		});
	});
}

// --- LOGIC PARSER ---
function checkSqmContent(content) {
	// Regex Helpers
	const extractClass = (name, text) => {
		const regex = new RegExp(`class\\s+${name}\\s*\\{([\\s\\S]*?)\\};`, 'i');
		const match = text.match(regex);
		return match ? match[1] : null;
	};

	const findValue = (key, text) => {
		if (!text) return null;
		const regex = new RegExp(`\\b${key}\\b\\s*=\\s*([\\s\\S]*?);`, 'i');
		const match = text.match(regex);
		if (!match) return null;
		return match[1].replace(/"/g, '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
	};

	// 1. DATA EXTRACTION
	const scenarioData = extractClass('ScenarioData', content);
	// Try finding Intel inside 'Mission' first (standard), then globally if needed
	const missionClass = extractClass('Mission', content);
	const missionIntel = extractClass('Intel', missionClass || content);

	const author = findValue('author', scenarioData);
	const disabledAI = findValue('disabledAI', scenarioData);
	const overview = findValue('overviewText', scenarioData);
	const title = findValue('briefingName', missionIntel);

	// 2. COMPOSITION CHECK
	const requiredComps = ['BT Ship Comp', 'BT Spawn Comp'];
	let foundComp = null;

	for (const comp of requiredComps) {
		if (new RegExp(`name\\s*=\\s*"${comp}"`, 'i').test(content)) {
			foundComp = comp;
			break;
		}
	}

	return {
		hasAuthor: !!author,
		author: author,
		hasTitle: !!title,
		title: title,
		aiDisabled: disabledAI === '1',
		hasOverview: !!overview,
		hasComposition: !!foundComp,
		foundComp: foundComp,
	};
}