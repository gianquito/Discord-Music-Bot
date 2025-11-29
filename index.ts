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
import fetchstream from 'node-fetch'

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
        name: 'similar',
        description: 'Reproduce canciones similares!',
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
    {
        name: 'stop',
        description: 'Detiene la reproducción',
    },
]

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN!)

try {
    console.log('Started refreshing application (/) commands.')
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
        body: commands,
    })

    console.log('Successfully reloaded application (/) commands.')
} catch (error) {
    console.error(error)
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates],
})

const player = createAudioPlayer()

player.on(AudioPlayerStatus.Idle, async (e: any) => {
    const guildId = e.resource.metadata.guildId
    if (queues.hasOwnProperty(guildId) && queues[guildId].length > 0) {
        let url = queues[guildId].shift()!
        if (url === 'placeholder') {
            url = queues[guildId].shift()!
        }
        await playSong(url, guildId)
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
                if (!connection) return
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
                    await playSong(result.url, guildID)
                } else {
                    queues[guildID].push(result.url)
                }
            } catch (error) {
                console.error(error)
            }
        } else {
            void interaction.reply('Debes estar en un canal de voz!')
        }
    } else if (interaction.commandName === 'similar') {
        //@ts-ignore
        const channel = interaction.member?.voice.channel
        if (channel) {
            try {
                const connection = await connectToChannel(channel)
                if (!connection) return
                connection.subscribe(player)

                const spotifyAuthReq = await fetch(
                    'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            Cookie: 'sp_dc=AQCds8GKXXRb4_3OGHihNn3RbE3zh7IIAv9SVYUIuLecQWwHiunjVrlEB6ncZ91Sv1yex-B2rdDv8Qhz0uhHoUe65zeWiSR9msS8NECjxB_EfEds0q1Kr-anaXrgdcRwsXO6SV1E1Yx2K65mNAVgT8frsdchWdo',
                        },
                    }
                )

                const spotifyAuth = (await spotifyAuthReq.json()) as {
                    accessToken: string
                }

                const spotifyTrackReq = await fetch(
                    `https://api.spotify.com/v1/search?q=${
                        interaction.options.get('canción')?.value
                    }&type=track&limit=1`,
                    {
                        headers: {
                            Authorization: `Bearer ${spotifyAuth.accessToken}`,
                        },
                    }
                )

                const spotifyTrack = (await spotifyTrackReq.json()) as {
                    tracks: {
                        items: { id: string; name: string; artists: { name: string }[] }[]
                    }
                }

                const spotifyPlaylistReq = await fetch(
                    `https://spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/spotify:track:${spotifyTrack.tracks.items[0].id}?response-format=json`,
                    {
                        headers: {
                            Authorization: `Bearer ${spotifyAuth.accessToken}`,
                        },
                    }
                )
                const spotifyPlaylist = (await spotifyPlaylistReq.json()) as {
                    mediaItems: { uri: string }[]
                }

                const spotifyPlaylistTracksReq = await fetch(
                    `https://api-partner.spotify.com/pathfinder/v1/query?operationName=fetchPlaylist&variables=%7B%22uri%22%3A%22spotify%3Aplaylist%3A${
                        spotifyPlaylist.mediaItems[0].uri.split(':')[2]
                    }%22%2C%22offset%22%3A0%2C%22limit%22%3A25%7D&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%2276849d094f1ac9870ac9dbd5731bde5dc228264574b5f5d8cbc8f5a8f2f26116%22%7D%7D`,
                    {
                        headers: {
                            Authorization: `Bearer ${spotifyAuth.accessToken}`,
                        },
                    }
                )

                const spotifyPlaylistTracks = (await spotifyPlaylistTracksReq.json()) as {
                    data: {
                        playlistV2: {
                            content: {
                                items: {
                                    itemV2: {
                                        data: {
                                            artists: {
                                                items: {
                                                    profile: {
                                                        name: string
                                                    }
                                                }[]
                                            }
                                            name: string
                                        }
                                    }
                                }[]
                            }
                        }
                    }
                }

                const radioTracks = [...spotifyPlaylistTracks.data.playlistV2.content.items].slice(0, 10)
                await interaction.reply(
                    `Se agregó **${spotifyTrack.tracks.items[0].name}** de **${spotifyTrack.tracks.items[0].artists[0].name}** y **${radioTracks.length}** canciones similares a la cola`
                )
                const guildID = interaction.guildId!

                shuffleArray(radioTracks)

                const tracks = [
                    spotifyTrack.tracks.items[0],
                    ...radioTracks.map((item) => ({
                        name: item.itemV2.data.name,
                        artists: item.itemV2.data.artists.items.map((artist) => ({ name: artist.profile.name })),
                    })),
                ]
                for (let track of tracks) {
                    const result = await YouTube.searchOne(
                        `${track.name} ${track.artists.map((artist: { name: string }) => artist.name).join(' ')}`
                    )
                    if (
                        player.state.status !== AudioPlayerStatus.Playing &&
                        (!queues.hasOwnProperty(guildID) || queues[guildID].length === 0)
                    ) {
                        //empty queue, just play it
                        queues[guildID] = []
                        queues[guildID].push('placeholder')
                        await playSong(result.url, guildID)
                    } else {
                        queues[guildID].push(result.url)
                    }
                }
            } catch (error) {
                console.error(error)
            }
        } else {
            void interaction.reply('Debes estar en un canal de voz!')
        }
    } else if (interaction.commandName === 'skip') {
        if (queues.hasOwnProperty(interaction.guildId!) && queues[interaction.guildId!].length > 0) {
            let url = queues[interaction.guildId!].shift()!
            if (url === 'placeholder') {
                url = queues[interaction.guildId!].shift()!
            }
            await playSong(url, interaction.guildId!)
        } else {
            player.stop()
        }
        await interaction.reply('Se omitió la canción')
    } else if (interaction.commandName === 'stop') {
        if (queues.hasOwnProperty(interaction.guildId!)) {
            player.stop()
            queues[interaction.guildId!] = []
        }
        await interaction.reply('Se detuvo la reproducción')
    }
})

async function playSong(url: string, guildId: string) {
    const req = await fetch('http://localhost:9000', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: url,
            downloadMode: 'audio',
            disableMetadata: true,
        }),
    })
    const data: any = await req.json()
    const audio = await fetchstream(data.url)
    //@ts-ignore
    const resource = createAudioResource(audio.body, {
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
        console.log(error)
    }
}

function shuffleArray(array: any[]) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[array[i], array[j]] = [array[j], array[i]]
    }
}

client.login(process.env.TOKEN!)
