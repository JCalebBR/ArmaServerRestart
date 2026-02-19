const { Events } = require('discord.js');

// 🛑 Replace with your actual channel ID if process.env isn't loading!
const SCREENSHOT_CHANNEL_ID = process.env.SCOREBOARD_CHANNEL_ID;

function getEstDateString(dateObject) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/New_York',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(dateObject);
}

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;
		if (message.channelId !== SCREENSHOT_CHANNEL_ID) return;

		if (message.attachments.size === 0) return;

		const hasTriggerImage = message.attachments.some(att => att.contentType && att.contentType.startsWith('image/'));

		if (!hasTriggerImage) return;

		console.log(`\n[DEBUG] --- New Message in Screenshot Channel ---`);
		console.log(`[DEBUG] Target Channel ID: ${SCREENSHOT_CHANNEL_ID}`);
		console.log(`[DEBUG] Author: ${message.author.tag}`);
		console.log(`[DEBUG] Content: "${message.content}"`);
		console.log(`[DEBUG] Attachments count: ${message.attachments.size}`);

		const contentLower = message.content.toLowerCase();
		let baseType = '';

		// 3. Keyword Check
		if (contentLower.includes('main op') || contentLower.includes('main operation')) {
			baseType = 'Main Operation';
		} else if (contentLower.includes('incursion')) {
			baseType = 'Incursion';
		}

		if (!baseType) {
			console.log(`[DEBUG] Aborting: Neither "main op" nor "incursion" were found in the message text.`);
			return;
		}

		console.log(`[DEBUG] Matched base type: ${baseType}`);

		const todayEST = getEstDateString(new Date());
		console.log(`[DEBUG] Today's EST Date: ${todayEST}`);

		try {
			console.log(`[DEBUG] Fetching recent messages to calculate operation count...`);
			const recentMessages = await message.channel.messages.fetch({ limit: 50 });

			let opCount = 0;

			for (const [id, msg] of recentMessages) {
				if (msg.attachments.size === 0) continue;
				const hasImages = msg.attachments.some(att => att.contentType && att.contentType.startsWith('image/'));
				if (!hasImages) continue;

				const msgDateEST = getEstDateString(msg.createdAt);

				if (msgDateEST === todayEST) {
					const msgLower = msg.content.toLowerCase();

					if (baseType === 'Main Operation' && (msgLower.includes('main op') || msgLower.includes('main operation'))) {
						opCount++;
					} else if (baseType === 'Incursion' && msgLower.includes('incursion')) {
						opCount++;
					}
				}
			}

			console.log(`[DEBUG] Total operations of this type found today (including this one): ${opCount}`);

			const opType = opCount > 1 ? `${baseType} ${opCount}` : baseType;
			const threadName = `${opType}: ${todayEST}`;

			console.log(`[DEBUG] Attempting to create thread named: "${threadName}"`);

			// 4. Thread Creation
			const thread = await message.startThread({
				name: threadName,
				autoArchiveDuration: 1440,
				reason: 'Automated Operation Corrections Thread',
			});

			console.log(`[DEBUG] ✅ Thread created successfully! ID: ${thread.id}`);

			// 5. Instruction Post
			const instructionMsg = await thread.send(`Salutations my lords.\n**Please provide corrections to the operation screenshots below in this exact format.**\nRename: "OLD_NAME" "NEW_NAME" - Ex. Actor named Mosk Pius but player is Moss Caessian, Rename: "Mosk Pius" "Moss Caessian"\nDeath discount: NUMBER_OF_DEATHS - The amount of deaths to subtract from the total, this must be done by the player themselves.`);

			await instructionMsg.pin();
			console.log(`[DEBUG] ✅ Instructions sent and pinned.`);

		} catch (error) {
			console.error('\n[ERROR] Failed during thread creation workflow:');
			console.error(error);
		}
	},
};