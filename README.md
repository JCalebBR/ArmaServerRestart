# ArmaServerRestart

## Steam Workshop mod updates

The `/update` command updates every numeric mod folder directly under the configured staging directory. It requires all Arma server and headless-client processes to be stopped.

Before deploying the command on the Windows host:

1. Install SteamCMD at `C:\steamcmd\steamcmd.exe`.
2. Run SteamCMD interactively as the same Windows account that runs the bot, log in with a dedicated Steam account, and complete Steam Guard authorization.
3. Confirm that `steamcmd.exe +@NoPromptForPassword 1 +login YOUR_ACCOUNT +quit` can log in without prompting.
4. Set `steamWorkshop.username` in `servers.json`; adjust the executable or staging paths there if necessary.
5. Run `node deploy-commands.js` with the bot's normal environment variables to register `/update` with Discord.

SteamCMD downloads Workshop content into the staging directory's `steamapps\workshop\content\107410` cache. The bot mirrors only changed items into the existing `<workshopId>` staging folders and never stores the Steam password.

## Server process lifecycle

The `/start`, `/stop`, and `/restart` commands identify servers from the arguments of every running `arma3server*` process. This allows `/stop` and `/restart` to remove duplicate or orphaned processes even when they failed to bind their configured port.

- `/start` refuses to launch while any matching server or headless-client process exists.
- `/stop` terminates and verifies removal of every matching process tree.
- `/restart` always converges to one configured server and the configured headless-client count, including when initially offline.
- An incomplete startup is rolled back instead of leaving a partial process set.

The Windows account running the bot must be allowed to read process command lines through CIM and terminate the Arma process trees.

## Minecraft server management

Marcus can manage one Minecraft Java server through the existing `/start`, `/stop`, `/restart`, and `/status` commands. It also provides `/whitelist`, `/mcstats`, a two-way Discord chat relay, and scheduled restarts at 00:00, 04:00, 08:00, 12:00, 16:00, and 20:00 in the Windows host's local time.

Copy the `Minecraft` entry from `servers.example.json` into the ignored `servers.json` and replace the example paths. In the ATM server's `user_jvm_args.txt`, add this line so Marcus can distinguish the server from other Java programs:

```text
-Dmarcus.serverId=minecraft
```

Initialize the ATM server pack manually and confirm `startserver.bat` works before controlling it through Discord. The PM2 daemon must run in the logged-in interactive Windows session for the independently launched console window to be visible; a Windows service running in session 0 cannot display that GUI.

Configure these values in the server's `server.properties`:

```properties
server-port=25565
enable-rcon=true
rcon.port=25575
rcon.password=USE_A_LONG_RANDOM_PASSWORD
white-list=true
enforce-whitelist=true
broadcast-rcon-to-ops=false
```

Do not port-forward TCP 25575. Block external access to the RCON port in Windows Firewall. Marcus loads environment variables from a `.env` file in the repository root, so put the same password there (with no extra spaces around the variable name):

```dotenv
MINECRAFT_RCON_PASSWORD=USE_THE_SAME_PASSWORD
```

Values already supplied by the process environment take precedence over `.env`. Restart Marcus after changing the file:

```powershell
pm2 restart Marcus --update-env
pm2 save
```

After pulling a release containing new dependencies or commands, run `npm ci` and `node deploy-commands.js` before restarting Marcus. Whitelist requests made while Minecraft is offline are stored in the ignored `minecraft_state.db` file and applied after RCON becomes available.

The chat bridge uses channel `1194397220234072064` from the server configuration. Unicode emoji are relayed directly, custom Discord emoji become `:emoji_name:` in Minecraft, and images, stickers, and GIFs appear as clickable URLs. `/mcstats` reads the latest persisted player snapshot from the configured world's `stats` directory; online-player values can therefore lag behind live gameplay.
