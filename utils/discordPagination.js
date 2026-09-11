const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
} = require('discord.js');

const DEFAULT_TIMEOUT = 300_000;

function paginationRow(prefix, page, totalPages) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`${prefix}_previous`)
			.setLabel('◀ Previous')
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page === 0),
		new ButtonBuilder()
			.setCustomId(`${prefix}_next`)
			.setLabel('Next ▶')
			.setStyle(ButtonStyle.Primary)
			.setDisabled(page === totalPages - 1),
	);
}

async function sendPaginated(interaction, embeds, options = {}) {
	if (!embeds.length) throw new Error('At least one embed is required.');
	let page = 0;
	const prefix = options.prefix || `pages_${interaction.id}`;
	const payload = {
		embeds: [embeds[0]],
		components: embeds.length > 1 ? [paginationRow(prefix, page, embeds.length)] : [],
		allowedMentions: options.allowedMentions,
	};
	const message = options.editReply
		? await interaction.editReply({ ...payload, fetchReply: true })
		: await interaction.reply({ ...payload, fetchReply: true });
	if (embeds.length === 1) return message;

	const collector = message.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: options.timeoutMs || DEFAULT_TIMEOUT,
	});
	collector.on('collect', async button => {
		if (button.user.id !== interaction.user.id) {
			return button.reply({ content: '🚫 You cannot interact with this menu.', ephemeral: true });
		}
		if (button.customId === `${prefix}_previous`) page--;
		if (button.customId === `${prefix}_next`) page++;
		page = Math.max(0, Math.min(page, embeds.length - 1));
		await button.update({ embeds: [embeds[page]], components: [paginationRow(prefix, page, embeds.length)] });
	});
	collector.on('end', () => message.edit({ components: [] }).catch(() => undefined));
	return message;
}

function paginateLines(lines, maxLength = 3600) {
	const pages = [];
	let current = '';
	for (const originalLine of lines) {
		const line = String(originalLine).slice(0, maxLength);
		if (current && current.length + line.length + 1 > maxLength) {
			pages.push(current);
			current = '';
		}
		current += `${current ? '\n' : ''}${line}`;
	}
	if (current || pages.length === 0) pages.push(current || 'No entries.');
	return pages;
}

module.exports = { paginateLines, paginationRow, sendPaginated };
