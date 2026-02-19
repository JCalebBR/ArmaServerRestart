const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const strings = require('../utils/strings');

module.exports = {
	data: new SlashCommandBuilder()
		.setName(strings.commands.reload.name)
		.setDescription(strings.commands.reload.desc)
		.addStringOption(option =>
			option.setName(strings.commands.reload.args.first.name)
				.setDescription(strings.commands.reload.args.first.desc)
				.setRequired(true)
				.setAutocomplete(true),
		),
	async autocomplete(interaction) {
		const focusedValue = interaction.options.getFocused();
		const commands = interaction.client.commands.map(cmd => cmd.data.name);
		const filtered = commands.filter(cmd => cmd.startsWith(focusedValue));
		await interaction.respond(filtered);
	},
	async execute(interaction) {
		const commandName = interaction.options.getString('command', true).toLowerCase();
		const command = interaction.client.commands.get(commandName);

		if (!command) {
			return interaction.reply(strings.errors.noFile(commandName));
		}

		let commandPath = null;

		// Go up one level from 'commands/utility' to 'commands/'
		const commandsDir = path.join(__dirname, '../');
		const commandFolders = fs.readdirSync(commandsDir);

		for (const folder of commandFolders) {
			const folderPath = path.join(commandsDir, folder);

			// Only look inside folders
			if (fs.statSync(folderPath).isDirectory()) {
				const potentialPath = path.join(folderPath, `${command.data.name}.js`);
				if (fs.existsSync(potentialPath)) {
					commandPath = potentialPath;
					break;
				}
			}
		}

		if (!commandPath) {
			return interaction.reply(strings.errors.noFile(commandName));
		}

		delete require.cache[require.resolve(commandPath)];

		try {
			const newCommand = require(commandPath);
			interaction.client.commands.set(newCommand.data.name, newCommand);
			await interaction.reply(`Command \`${newCommand.data.name}\` was reloaded!`);
		} catch (error) {
			console.error(error);
			await interaction.reply(
				`There was an error while reloading a command \`${command.data.name}\`:\n\`${error.message}\``,
			);
		}
	},
};