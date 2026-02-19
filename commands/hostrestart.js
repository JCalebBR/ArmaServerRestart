const { SlashCommandBuilder } = require('discord.js');
const { exec } = require('child_process');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('hostreboot')
		.setDescription('🚨 Restarts the physical host machine (Server Owners Only).'),

	async execute(interaction) {

		// 2. Warn the admin that it's happening
		await interaction.reply({
			content: '⚠️ **Initiating Host Machine Reboot.** \n\nThe OS is restarting. The bot, Arma 3 server, and RDP services will drop in a few seconds. See you on the other side.',
			ephemeral: true,
		});

		// 3. Execute the Windows restart command
		// /r = restart, /t 5 = 5 second delay, /f = force close apps, /c = event viewer comment
		const command = 'shutdown /r /f /t 5 /c "Emergency host reboot triggered via Discord Bot"';


		exec(command, (error, stdout, stderr) => {
			if (error) {
				console.error(`Failed to execute reboot command: ${error}`);
				// We use followUp because we already replied above
				return interaction.followUp({
					content: `❌ Failed to initiate reboot. The bot might not have Administrator privileges on the Windows host. Error: \`${error.message}\``,
					ephemeral: true,
				});
			}
		});
	},
};