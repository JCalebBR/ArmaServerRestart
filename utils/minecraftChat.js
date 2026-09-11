const fs = require('fs');
const { StringDecoder } = require('string_decoder');
const { sendRcon } = require('./minecraftRcon');

function parseMinecraftChatLine(line) {
	const match = String(line).match(/\]: (?:\[Not Secure\]\s*)?<([^>]+)>\s+(.+)$/);
	if (!match) return null;
	const player = match[1].trim();
	const content = match[2].trim();
	if (!player || !content || content.startsWith('[Discord]')) return null;
	return { player, content };
}

function minecraftToDiscord(content, emojis) {
	return String(content).replace(/:([A-Za-z0-9_]{2,32}):/g, (match, name) => {
		const emoji = emojis?.find?.(candidate => candidate.name === name);
		return emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : match;
	});
}

function discordContentToMinecraft(message) {
	let content = String(message.cleanContent || message.content || '')
		.replace(/<a?:([A-Za-z0-9_]{2,32}):\d+>/g, ':$1:')
		.replace(/@everyone/g, '@ everyone')
		.replace(/@here/g, '@ here')
		.trim();
	const urls = [];
	for (const attachment of message.attachments?.values?.() || []) urls.push(attachment.url);
	for (const sticker of message.stickers?.values?.() || []) if (sticker.url) urls.push(sticker.url);
	if (urls.length > 0) content += `${content ? '\n' : ''}${urls.join('\n')}`;
	return content.trim();
}

function splitText(value, maxLength = 700) {
	const chunks = [];
	let remaining = String(value || '');
	while (remaining.length > maxLength) {
		let splitAt = remaining.lastIndexOf(' ', maxLength);
		if (splitAt < maxLength / 2) splitAt = maxLength;
		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).trimStart();
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}

function tellrawForDiscord(nickname, content) {
	const components = [
		{ text: '[Discord] ', color: 'blue' },
		{ text: `<${nickname}> `, color: 'aqua' },
	];
	const urlPattern = /(https?:\/\/[^\s]+)/g;
	let offset = 0;
	for (const match of content.matchAll(urlPattern)) {
		if (match.index > offset) components.push({ text: content.slice(offset, match.index), color: 'white' });
		components.push({
			text: match[0],
			color: 'blue',
			underlined: true,
			clickEvent: { action: 'open_url', value: match[0] },
		});
		offset = match.index + match[0].length;
	}
	if (offset < content.length) components.push({ text: content.slice(offset), color: 'white' });
	return `tellraw @a ${JSON.stringify(components)}`;
}

async function relayDiscordMessage(serverConfig, message, options = {}) {
	const content = discordContentToMinecraft(message);
	if (!content) return 0;
	const nickname = message.member?.nickname || message.member?.displayName || message.author.globalName || message.author.username;
	const send = options.send || (command => sendRcon(serverConfig, command));
	const chunks = splitText(content);
	for (const chunk of chunks) await send(tellrawForDiscord(nickname, chunk));
	return chunks.length;
}

class MinecraftLogTailer {
	constructor(filePath, onLine, options = {}) {
		this.filePath = filePath;
		this.onLine = onLine;
		this.intervalMs = options.intervalMs || 1000;
		this.offset = 0;
		this.identity = null;
		this.partial = '';
		this.decoder = new StringDecoder('utf8');
		this.initialized = false;
		this.wasMissing = false;
		this.reading = false;
		this.timer = null;
	}

	async poll() {
		if (this.reading) return;
		this.reading = true;
		try {
			let stat;
			try { stat = await fs.promises.stat(this.filePath); }
			catch (error) {
				if (error.code === 'ENOENT') {
					this.wasMissing = true;
					return;
				}
				throw error;
			}
			const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
			if (!this.initialized) {
				this.initialized = true;
				this.identity = identity;
				this.offset = this.wasMissing ? 0 : stat.size;
				this.wasMissing = false;
				if (this.offset === stat.size) return;
			}
			if (this.wasMissing || this.identity !== identity || stat.size < this.offset) {
				this.identity = identity;
				this.offset = 0;
				this.partial = '';
				this.decoder = new StringDecoder('utf8');
				this.wasMissing = false;
			}
			if (stat.size === this.offset) return;

			const length = Math.min(stat.size - this.offset, 1024 * 1024);
			const handle = await fs.promises.open(this.filePath, 'r');
			const buffer = Buffer.alloc(length);
			let bytesRead;
			try { ({ bytesRead } = await handle.read(buffer, 0, length, this.offset)); }
			finally { await handle.close(); }
			this.offset += bytesRead;
			const lines = `${this.partial}${this.decoder.write(buffer.subarray(0, bytesRead))}`.split(/\r?\n/);
			this.partial = lines.pop() || '';
			for (const line of lines) await this.onLine(line);
		} finally {
			this.reading = false;
		}
	}

	start() {
		if (this.timer) return;
		this.poll().catch(error => console.error('[Minecraft Chat] Log tail failed:', error));
		this.timer = setInterval(() => {
			this.poll().catch(error => console.error('[Minecraft Chat] Log tail failed:', error));
		}, this.intervalMs);
		this.timer.unref?.();
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}

module.exports = {
	MinecraftLogTailer,
	discordContentToMinecraft,
	minecraftToDiscord,
	parseMinecraftChatLine,
	relayDiscordMessage,
	splitText,
	tellrawForDiscord,
};
