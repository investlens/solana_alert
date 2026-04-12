import { config } from '../config.js';

type InlineButton = {
  text: string;
  url: string;
};

export async function sendTelegram(
  chatId: string,
  text: string,
  buttons?: InlineButton[][]
) {
  if (!chatId) return;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (buttons?.length) {
    body.reply_markup = {
      inline_keyboard: buttons,
    };
  }

  if (config.dryRun) {
    console.log(
      `\n--- MESSAGE TO ${chatId} ---\n${text}\nButtons: ${JSON.stringify(
        buttons ?? []
      )}\n---------------------------\n`
    );
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Telegram send failed: ${res.status} ${bodyText}`);
  }
}