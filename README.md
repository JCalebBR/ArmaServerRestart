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
