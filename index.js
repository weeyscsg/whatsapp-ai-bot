import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import { Configuration, OpenAIApi } from 'openai';

// Load environment variables
dotenv.config();

const app = express();
app.use(bodyParser.json());

// OpenAI client setup
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

// ── COMMAND HANDLERS ────────────────────────────────────────────────────────
const commandHandlers = [
  { pattern: /\b(driver|download driver)\b/i, handler: handleDriverDownload },
  { pattern: /\b(speed|darkness)\b/i, handler: handleDriverConfig },
  { pattern: /\b(lighter print|light print|print lighter)\b/i, handler: handleLightnessAdvice },
  { pattern: /\b(model)\b/i, handler: handlePrinterModelMemory },
];

// ── UTILITIES ───────────────────────────────────────────────────────────────
function extractPrinterModel(message) {
  if (!message || typeof message !== 'string') return null;
  const match = message.match(/tsc\s*(\w+\d+)/i);
  return match ? match[1] : null;
}

// ── ROUTING / DISPATCH ────────────────────────────────────────────────────────
async function routeIncoming(from, text) {
  for (const { pattern, handler } of commandHandlers) {
    if (pattern.test(text)) {
      return handler(from, text);
    }
  }
  return handleGPT4Inquiry(from, text);
}

// ── MAIN REPLY GENERATOR ────────────────────────────────────────────────────
async function generateReply({ from, body, audio }) {
  let message = body || '';

  if (audio) {
    try {
      const { transcribeAudio } = await import('node-whisper');
      message = await transcribeAudio(audio);
    } catch (err) {
      console.warn('Whisper transcription failed:', err);
    }
  }

  const model = extractPrinterModel(message);
  if (model) {
    await handlePrinterModelMemory(from, model);
  }

  return routeIncoming(from, message);
}

// ── WEBHOOK HANDLER ─────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const messages = req.body.entry
    .flatMap(e => e.changes)
    .flatMap(c => c.value.messages || []);

  for (const msg of messages) {
    const from = msg.from;
    const body = msg.text?.body || '';
    const audio = msg.audio?.id;

    try {
      const reply = await generateReply({ from, body, audio });
      await sendText(from, reply);
    } catch (err) {
      console.error('Error handling message:', err);
      await sendText(from, 'Oops, something went wrong.');
    }
  }

  res.sendStatus(200);
});

// ── START SERVER ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

// ── HANDLER FUNCTIONS ───────────────────────────────────────────────────────
async function handleDriverDownload(from, text) {
  return sendText(from, 'Download TSC drivers here: https://www.tscprinters.com/DriverDownload');
}
async function handleDriverConfig(from, text) {
  return sendText(from, 'Adjust speed/darkness under Advanced settings in your TSC driver.');
}
async function handleLightnessAdvice(from, text) {
  return sendText(from, 'If prints are too light, increase darkness by 1–2 levels in driver settings.');
}
async function handlePrinterModelMemory(from, model) {
  // TODO: store per-user model memory with 48h expiry
  return sendText(from, `Got it! Remembering your printer model: ${model}`);
}
async function handleGPT4Inquiry(from, text) {
  const resp = await openai.createChatCompletion({
    model: 'gpt-4-turbo',
    messages: [{ role: 'user', content: text }],
  });
  return resp.data.choices[0].message.content;
}

// ── WHATSAPP SENDER ─────────────────────────────────────────────────────────
async function sendText(to, msg) {
  try {
    const url = `https://graph.facebook.com/v15.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to,
      text: { body: msg },
    };
    const headers = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
    const resp = await axios.post(url, payload, { headers });
    console.log(`Sent message to ${to}: ${msg}`);
  } catch (error) {
    console.error('Failed to send message:', error.response?.data || error);
  }
}
