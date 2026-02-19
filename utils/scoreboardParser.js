const sharp = require('sharp');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const CROP_BOX = { left: 0.22, top: 0.25, width: 0.56, height: 0.45 };
const BAD_NAMES = ['headlessclient', 'headlessclient (2)', 'hc1', 'hc2', 'hc3'];

const SYSTEM_PROMPT = `
You are a data extraction assistant for an Arma 3 scoreboard.
Columns: Rank, Name, Infantry Kills, Soft Vehicle Kills, Armored Vehicle Kills, Air Kills, Deaths, Score.
Rules:
1. Combine data from all images.
2. Remove duplicates based on Rank.
3. Ignore summary rows without a Rank (e.g., BLUFOR, OPFOR).
4. STRICTLY output a JSON array only. No markdown formatting.
Format: { "rank": 1, "name": "[SI] Zacharia Wolff", "inf_kills": 66, "soft_veh": 0, "armor_veh": 4, "air": 0, "deaths": 2, "score": 78 }
`;

async function extractAndCleanScoreboardData(attachments) {
	// 1. Process Images
	const imageContents = [];
	for (const att of attachments) {
		const response = await fetch(att.url);
		const arrayBuffer = await response.arrayBuffer();
		const image = sharp(Buffer.from(arrayBuffer));
		const metadata = await image.metadata();

		const width = metadata.width;
		const height = metadata.height;
		const actualRatio = width / height;
		const targetRatio = 16 / 9;

		// Dynamic Scaling: If the monitor is ultrawide, Arma anchors the UI to a 16:9 center box
		let referenceWidth = width;
		let xOffset = 0;

		// 0.05 buffer to account for minor rounding differences in standard 16:9 resolutions
		if (actualRatio > (targetRatio + 0.05)) {
			referenceWidth = height * targetRatio;
			xOffset = (width - referenceWidth) / 2;
		}

		let processedBuffer;

		// As long as the height is decent, we apply the crop!
		if (width >= 1280 && height >= 720) {
			processedBuffer = await image.extract({
				left: Math.floor(xOffset + (referenceWidth * CROP_BOX.left)),
				top: Math.floor(height * CROP_BOX.top),
				width: Math.floor(referenceWidth * CROP_BOX.width),
				height: Math.floor(height * CROP_BOX.height),
			}).png().toBuffer();
		} else {
			// Fallback for extremely tiny/thumbnail images
			processedBuffer = await image.png().toBuffer();
		}

		imageContents.push({
			type: 'image',
			source: { type: 'base64', media_type: 'image/png', data: processedBuffer.toString('base64') },
		});
	}

	// 2. Call Claude
	const message = await anthropic.messages.create({
		model: 'claude-opus-4-5-20251101',
		max_tokens: 4096,
		temperature: 0,
		system: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: [...imageContents, { type: 'text', text: 'Extract scoreboard data and return JSON only.' }] }],
	});

	// 3. Parse JSON
	const rawOutput = message.content[0].text.trim();
	const jsonString = rawOutput.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
	const parsedData = JSON.parse(jsonString);

	// 4. Clean Names & Filter Ghosts
	let cleanedData = parsedData.map(player => {
		let cleanName = player.name ? player.name.replace(/^\[?[^\]]+\]\s*/, '').trim() : '';
		cleanName = cleanName.split(' ').map(word => word.length === 0 ? '' : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
		return { ...player, name: cleanName };
	});

	cleanedData = cleanedData.filter(player => {
		if (!player.name || player.name === '') return false;
		if (BAD_NAMES.includes(player.name.toLowerCase())) return false;
		return true;
	});

	return cleanedData;
}

module.exports = { extractAndCleanScoreboardData };