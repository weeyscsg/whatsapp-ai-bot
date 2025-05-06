import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

const app = express();
app.use(bodyParser.json());

// Initialize OpenAI client (v4.x default export)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ── COMMAND HANDLERS ────────────────────────────────────────────────────────
const commandHandlers = [
  { pattern: /\b(hi|hello)\b/i, handler: handleGreeting },
  { pattern: /\b(driver|download driver)\b/i, handler: handleDriverDownload },
  {
    // Matches queries about TSC software or labeling software
    pattern: /(?:tsc.*software|label(?:ing)?.*software|software.*tsc|software.*label(?:ing)?)/i,
    handler: handleSoftwareLink
  },
  {
    // Matches TSC Windows driver or installation driver queries
    pattern: /(?:tsc.*(?:windows?|win)\s*driver|windows?\s*driver|install(?:ation)?\s*driver|driver\s*install(?:ation)?)/i,
    handler: handleWindowsDriverLink
  },
  {
    // Matches driver configuration, speed, darkness, print lighter/darker, fading, etc.
    pattern: /(?:tsc.*driver.*config(?:uration)?|driver.*config(?:uration)?|configure.*driver|driver settings|adjust.*(?:speed|darkness)|(?:lighter|darker|light|dark).*(?:print|printout)|fading|print faint)/i,
    handler: handleDriverConfig
  },
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
      if (typeof reply === 'string' && reply) {
        await sendText(from, reply);
      }
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
async function handleGreeting(from, text) {
  return 'Hello! How can I assist you today?';
}

async function handleDriverDownload(from, text) {
  return 'Download TSC drivers here: https://wa.me/p/7261706730612270/60102317781';
}

async function handleSoftwareLink(from, text) {
  return "Here's the TSC Labeling Software link: https://wa.me/p/25438061125807295/60102317781";
}

async function handleWindowsDriverLink(from, text) {
  return "Here's the TSC Windows/installation driver link: https://wa.me/p/7261706730612270/60102317781";
}

async function handleDriverConfig(from, text) {
  return 'For printer driver configuration (speed, darkness, print quality), check this tutorial: https://wa.me/p/8073532716014276/60102317781';
}

async function handlePrinterModelMemory(from, model) {
  // TODO: store per-user printer model memory with 48h expiry
  return `Got it! Remembering your printer model: ${model}`;
}

async function handleGPT4Inquiry(from, text) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [{ role: 'user', content: text }],
  });
  return completion.choices[0].message.content;
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
    await axios.post(url, payload, { headers });
    console.log(`Sent message to ${to}: ${msg}`);
  } catch (error) {
    console.error('Failed to send message:', error.response?.data || error);
  }
}
