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
import { Innertube, Platform, Types, YTNodes } from 'youtubei.js'

// Youtube.js interpreter
Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
    const properties = []

    if (env.n) {
        properties.push(`n: exportedVars.nFunction("${env.n}")`)
    }

    if (env.sig) {
        properties.push(`sig: exportedVars.sigFunction("${env.sig}")`)
    }

    const code = `${data.output}\nreturn { ${properties.join(', ')} }`

    return new Function(code)()
}

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

const yt = await Innertube.create({ generate_session_locally: true, po_token: '' })

const player = createAudioPlayer()

player.on(AudioPlayerStatus.Idle, (e: any) => {
    const guildId = e.resource.metadata.guildId
    if (queues.hasOwnProperty(guildId) && queues[guildId].length > 0) {
        const id = queues[guildId].shift()!
        playSong(id, guildId)
    }
})

client.on('clientReady', () => {
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

                const songName = interaction.options.get('canción')?.value as string
                const search = await yt.music.search(songName, { type: 'song' })
                if (
                    !search.contents ||
                    search.contents.length === 0 ||
                    !search.contents[0].contents ||
                    search.contents[0].contents.length === 0
                ) {
                    await interaction.reply(`No se encontraron resultados para **${songName}**`)
                    return
                }

                const result = search.contents[0].contents[0] as YTNodes.MusicResponsiveListItem
                await interaction.reply(`Se agregó **${result.title}** de **${result.artists![0].name}** a la cola`)

                //queue
                const guildID = interaction.guildId!
                if (
                    player.state.status !== AudioPlayerStatus.Playing &&
                    (!queues.hasOwnProperty(guildID) || queues[guildID].length === 0)
                ) {
                    //empty queue, just play it
                    queues[guildID] = []
                    playSong(result.id as string, guildID)
                } else {
                    queues[guildID].push(result.id as string)
                }
            } catch (error) {
                console.error(error)
            }
        } else {
            void interaction.reply('Debes estar en un canal de voz!')
        }
    } else if (interaction.commandName === 'skip') {
        if (queues.hasOwnProperty(interaction.guildId!) && queues[interaction.guildId!].length > 0) {
            const id = queues[interaction.guildId!].shift()!
            playSong(id, interaction.guildId!)
        } else {
            player.stop()
        }
        await interaction.reply('Se omitió la canción')
    }
})

async function playSong(id: string, guildId: string) {
    const stream = await yt.download(id, {
        type: 'video+audio',
        quality: 'best',
        format: 'mp4',
        client: 'ANDROID',
    })

    const resource = createAudioResource(stream, {
        metadata: {
            guildId: guildId,
        },
        inputType: StreamType.Arbitrary,
    })

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
