import 'dotenv/config'
import { REST, Routes, Client, GatewayIntentBits, VoiceBasedChannel } from 'discord.js'
import {
    AudioPlayerStatus,
    StreamType,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    joinVoiceChannel,
} from '@discordjs/voice'
import { createDiscordJSAdapter } from './adapter.js'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const YouTube = require('youtube-sr').default
const ytdl = require('ytdl-core')

const queues: { [key: string]: string[] } = { a: [] }

const commands = [
    {
        name: 'play',
        description: 'Reproduce una canción!',
        options: [
            {
                name: 'canción',
                description: 'El nombre de la canción o URL',
                type: 3,
                required: true,
            },
        ],
    },
    {
        name: 'skip',
        description: 'Omitir la canción actual',
    },
]

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN!)

try {
    console.log('Started refreshing application (/) commands.')
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), { body: commands })

    console.log('Successfully reloaded application (/) commands.')
} catch (error) {
    console.error(error)
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
})

const player = createAudioPlayer()

player.on(AudioPlayerStatus.Idle, (e: any) => {
    const guildId = e.resource.metadata.guildId
    if (queues.hasOwnProperty(guildId) && queues[guildId].length > 0) {
        const url = queues[guildId].shift()!
        playSong(url, guildId)
    }
})

client.on('ready', () => {
    console.log(`Logged in as ${client.user!.tag}!`)
})

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return
    if (interaction.commandName === 'play') {
        //@ts-ignore
        const channel = interaction.member?.voice.channel
        if (channel) {
            try {
                const connection = await connectToChannel(channel)

                connection.subscribe(player)

                const result = await YouTube.searchOne(interaction.options.get('canción')?.value)
                await interaction.reply(`Se agregó **${result.title}** de **${result.channel.name}** a la cola`)

                //queue
                const guildID = interaction.guildId!
                if (
                    player.state.status !== AudioPlayerStatus.Playing &&
                    (!queues.hasOwnProperty(guildID) || queues[guildID].length === 0)
                ) {
                    //empty queue, just play it
                    queues[guildID] = []
                    playSong(result.url, guildID)
                } else {
                    queues[guildID].push(result.url)
                }
            } catch (error) {
                console.error(error)
            }
        } else {
            void interaction.reply('Debes estar en un canal de voz!')
        }
    } else if (interaction.commandName === 'skip') {
        if (queues.hasOwnProperty(interaction.guildId!) && queues[interaction.guildId!].length > 0) {
            const url = queues[interaction.guildId!].shift()!
            playSong(url, interaction.guildId!)
        } else {
            player.stop()
        }
        await interaction.reply('Se omitió la canción')
    }
})

function playSong(url: string, guildId: string) {
    const resource = createAudioResource(
        ytdl(url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25,
        }),
        {
            metadata: {
                guildId: guildId,
            },
            inputType: StreamType.Arbitrary,
        }
    )

    player.play(resource)
    return entersState(player, AudioPlayerStatus.Playing, 5000)
}

async function connectToChannel(channel: VoiceBasedChannel) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: createDiscordJSAdapter(channel),
        debug: true,
    })
    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000)

        return connection
    } catch (error) {
        connection.destroy()
        throw error
    }
}

client.login(process.env.TOKEN!)
