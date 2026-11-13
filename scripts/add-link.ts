// Prints the link that adds Mnemo to your server:
//   npm run add-link -- https://talk.example.org
// Open it signed in as the Owner (or with Manage bots), tick the channels
// Mnemo may work in, confirm, and copy the token shown once.
import { readFileSync } from 'node:fs'
import { addBotLink, type Manifest } from '@mnema-xyz/bot-sdk'

const server = process.argv[2] ?? process.env.MNEMA_URL
if (!server || !/^https?:\/\//.test(server)) {
  console.error('Usage: npm run add-link -- https://your-mnema-talk-server')
  process.exit(64)
}
const manifest = JSON.parse(readFileSync(new URL('../mnemo.manifest.json', import.meta.url), 'utf8')) as Manifest
console.log(addBotLink(server, manifest))
