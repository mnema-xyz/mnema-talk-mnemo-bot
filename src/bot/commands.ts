// Mnemo's slash command, shared by the bot (registered at start) and the
// manifest (registered when an Owner adds Mnemo).
import { OptionType, type CommandInput } from '@mnema-xyz/bot-sdk'

export const ASK_COMMAND: CommandInput = {
  name: 'ask',
  description: 'Ask Mnemo a question',
  options: [
    { name: 'question', description: 'What do you want to know?', type: OptionType.String, required: true },
    { name: 'private', description: 'Only you see the answer', type: OptionType.Boolean, required: false },
  ],
}

/** Admin-only: how the last public answer in this channel was made. The
 * platform cannot hide a command from members, so Mnemo registers it only
 * when admins are configured and refuses everyone else in private. */
export const DETAILS_COMMAND: CommandInput = {
  name: 'details',
  description: 'For Mnemo admins: how the last answer in this channel was made',
}

/** The manifest lists only /ask; /details is added at start when needed. */
export const COMMANDS: CommandInput[] = [ASK_COMMAND]

export function commandsFor(adminUserIds: readonly string[]): CommandInput[] {
  return adminUserIds.length > 0 ? [ASK_COMMAND, DETAILS_COMMAND] : COMMANDS
}
