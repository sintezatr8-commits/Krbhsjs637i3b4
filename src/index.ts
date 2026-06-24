import dotenv from 'dotenv';
dotenv.config();

import mineflayer from 'mineflayer';
import { 
    Client, 
    GatewayIntentBits, 
    TextChannel, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    Message,
    Interaction
} from 'discord.js';

// Проверка критических переменных окружения
if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
    console.error("❌ Критические переменные окружения (DISCORD_TOKEN или DISCORD_CHANNEL_ID) не заданы!");
    process.exit(1);
}

// Конфигурация Minecraft-бота
interface MCConfig {
    host: string;
    port: number;
    username: string;
    version: boolean | string;
}

const mcConfig: MCConfig = {
    host: process.env.MC_HOST || '',
    port: parseInt(process.env.MC_PORT || '25565'),
    username: process.env.MC_USERNAME || 'MineflayerBot',
    version: false
};

let bot: mineflayer.Bot | null = null;
let discordChannel: TextChannel | null = null;
let isTargetOnline: boolean = false; // Должен ли бот быть в сети по воле юзера
let controlPanelMessage: Message | null = null; // Храним сообщение панели, чтобы обновлять его

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Проверка: находится ли бот физически на сервере в данный момент
const isBotInGame = (): boolean => {
    return !!(bot && bot.entity);
};

// --- ЛОГИКА MINECRAFT ---

function startMineflayer(): void {
    if (!mcConfig.host) {
        logToDiscord('⚠️ **Ошибка:** Не задан IP сервера. Используй команду `!setip [ip]` в чат.');
        return;
    }

    isTargetOnline = true;
    if (bot) {
        try { bot.end(); } catch (e) {}
    }

    bot = mineflayer.createBot(mcConfig as mineflayer.BotOptions);

    bot.once('spawn', () => {
        logToDiscord('🟢 **Бот успешно зашел на сервер Minecraft!**');
        updateControlPanel();
    });

    bot.on('chat', (username: string, message: string) => {
        if (username === bot?.username) return;
        logToDiscord(`💬 **[${username}]**: ${message}`);
    });

    // Исправлено с 'kick' на 'kicked'
    bot.on('kicked', (reason: string) => {
        logToDiscord(`⚠️ Бота кикнули. Причина: ${reason}`);
        updateControlPanel();
    });

    bot.on('error', (err: Error) => {
        console.error('Ошибка Mineflayer:', err);
    });

    bot.on('end', () => {
        updateControlPanel();
        if (isTargetOnline) {
            logToDiscord('🔄 Соединение потеряно. Переподключение через 15 секунд...');
            setTimeout(() => {
                if (isTargetOnline) startMineflayer();
            }, 15000);
        } else {
            logToDiscord('🛑 Бот отключен от сервера.');
        }
    });
}

function stopMineflayer(): void {
    isTargetOnline = false;
    if (bot) {
        bot.end();
        bot = null;
    }
    updateControlPanel();
}

// --- ИНТЕРФЕЙС ДИСКОРДА (КНОПКИ И ПАНЕЛЬ) ---

function createPanelEmbed(): { embeds: EmbedBuilder[], components: ActionRowBuilder<ButtonBuilder>[] } {
    // Исправлена проверка статуса через хелпер isBotInGame()
    const botStatus = isBotInGame() ? '🟢 В сети (В игре)' : '🔴 Оффлайн';
    const targetStatus = isTargetOnline ? '🔄 Удержание 24/7 Активно' : '⏸️ На паузе (Выключен)';

    const embed = new EmbedBuilder()
        .setTitle('🎮 Управление Mineflayer Ботом')
        .setDescription('Интерактивная панель для контроля круглосуточного бота.')
        .setColor(isBotInGame() ? 0x2ecc71 : 0xe74c3c)
        .addFields(
            { name: 'Статус в игре', value: botStatus, inline: true },
            { name: 'Режим воркера', value: targetStatus, inline: true },
            { name: 'Текущие настройки', value: `**IP:** \`${mcConfig.host || 'Не задан'}\`\n**Порт:** \`${mcConfig.port}\`\n**Никнейм:** \`${mcConfig.username}\`` }
        )
        .setTimestamp()
        .setFooter({ text: 'GitHub Worker 24/7 Система' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_start')
            .setLabel('Запустить')
            .setStyle(ButtonStyle.Success)
            .setDisabled(isTargetOnline),
        new ButtonBuilder()
            .setCustomId('btn_stop')
            .setLabel('Остановить')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!isTargetOnline),
        new ButtonBuilder()
            .setCustomId('btn_reconnect')
            .setLabel('Перезайти')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isTargetOnline),
        new ButtonBuilder()
            .setCustomId('btn_refresh')
            .setLabel('Обновить статус')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

async function updateControlPanel(): Promise<void> {
    if (!discordChannel) return;

    const panelData = createPanelEmbed();

    try {
        if (controlPanelMessage) {
            await controlPanelMessage.edit(panelData);
        } else {
            controlPanelMessage = await discordChannel.send(panelData);
        }
    } catch (error) {
        console.error('Не удалось обновить панель управления:', error);
    }
}

function logToDiscord(message: string): void {
    console.log(message);
    if (discordChannel) {
        discordChannel.send(message).catch(console.error);
    }
}

discordClient.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton() || interaction.channelId !== process.env.DISCORD_CHANNEL_ID) return;

    await interaction.deferUpdate();

    switch (interaction.customId) {
        case 'btn_start':
            if (!isTargetOnline) startMineflayer();
            break;
        case 'btn_stop':
            stopMineflayer();
            logToDiscord('🛑 Ручная остановка бота через панель.');
            break;
        case 'btn_reconnect':
            if (isTargetOnline) {
                logToDiscord('🔄 Запрошен принудительный перезапуск сессии...');
                startMineflayer();
            }
            break;
        case 'btn_refresh':
            await updateControlPanel();
            break;
    }
});

discordClient.on('messageCreate', async (message: Message) => {
    if (message.author.bot || message.channel.id !== process.env.DISCORD_CHANNEL_ID) return;

    const args = message.content.trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (command === '!setip') {
        const ip = args[0];
        if (!ip) return message.reply('Использование: `!setip play.server.ru`');
        mcConfig.host = ip;
        await updateControlPanel();
        message.react('✅');
    }

    if (command === '!setport') {
        const port = parseInt(args[0]);
        if (isNaN(port)) return message.reply('Использование: `!setport 25565`');
        mcConfig.port = port;
        await updateControlPanel();
        message.react('✅');
    }

    if (command === '!setnick') {
        const nick = args[0];
        if (!nick) return message.reply('Использование: `!setnick BotName`');
        mcConfig.username = nick;
        await updateControlPanel();
        message.react('✅');
    }

    if (command === '!say') {
        const msg = args.join(' ');
        if (!msg) return message.reply('Использование: `!say Всем привет`');
        // Исправлено и тут
        if (bot && isBotInGame()) {
            bot.chat(msg);
            message.react('💬');
        } else {
            message.reply('❌ Бот сейчас не в игре.');
        }
    }
});

discordClient.once('ready', async () => {
    console.log(`Дискорд бот (TS) запущен: ${discordClient.user?.tag}`);
    try {
        const channel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID!);
        if (channel && channel.isTextBased()) {
            discordChannel = channel as TextChannel;
            
            controlPanelMessage = null; 
            await updateControlPanel();

            if (mcConfig.host) {
                startMineflayer();
            }
        }
    } catch (e) {
        console.error(e);
    }
});

discordClient.login(process.env.DISCORD_TOKEN);
