// Mnemo's slash command, shared by the bot (registered at start) and the
// manifest (registered when an Owner adds Mnemo).
import { OptionType, type CommandInput } from 'mnema-talk-sdk'

export const ASK_COMMAND: CommandInput = {
  name: 'ask',
  description: 'Ask Mnemo a question',
  options: [
    { name: 'question', description: 'What do you want to know?', type: OptionType.String, required: true },
    { name: 'private', description: 'Only you see the answer', type: OptionType.Boolean, required: false },
  ],
}

export const COMMANDS: CommandInput[] = [ASK_COMMAND]
