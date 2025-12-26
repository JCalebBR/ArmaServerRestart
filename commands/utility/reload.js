const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('reload')
		.setDescription('Reloads a command')
		// FIX 1: You must define the option here for Discord to show the input box
		.addStringOption(option =>
			option.setName('command')
				.setDescription('The command to reload')
				.setRequired(true),
		),
	async execute(interaction) {
		const commandName = interaction.options.getString('command', true).toLowerCase();
		const command = interaction.client.commands.get(commandName);

		if (!command) {
			return interaction.reply(`There is no command with name \`${commandName}\`!`);
		}

		// FIX 2: Robust Path Finding
		// We can't assume the command is in the same folder as this script.
		// We scan the parent "commands" directory to find where the file actually lives.

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
			return interaction.reply(`Could not locate the file for \`${commandName}\`. Is it in a subfolder?`);
		}

		// FIX 3: Clear the cache using the ABSOLUTE path found above
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