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

// In-memory store for user printer models with 48h expiry
const userModels = new Map();
function getUserModel(from) {
  const entry = userModels.get(from);
  if (!entry || Date.now() > entry.expires) {
    userModels.delete(from);
    return null;
  }
  return entry.model;
}
function setUserModel(from, model) {
  userModels.set(from, {
    model,
    expires: Date.now() + 48 * 3600 * 1000
  });
}

// Utility to extract a real TSC model code, e.g. "TSC TTP-247"
function extractPrinterModel(message) {
  if (!message || typeof message !== 'string') return null;
  const match = message.match(/tsc\s*[\w-]*\d+/i);
  return match ? match[0] : null;
}

// Define intent handlers
const commandHandlers = [
  { pattern: /\b(hi|hello)\b/i, handler: handleGreeting },
  { pattern: /\b(driver|download driver)\b/i, handler: handleDriverDownload },
  {
    // TSC labeling software
    pattern: /(?:tsc.*software|label(?:ing)?.*software|software.*tsc|software.*label(?:ing)?)/i,
    handler: handleSoftwareLink
  },
  {
    // Windows or installation driver
    pattern: /(?:tsc.*(?:windows?|win)\s*driver|windows?\s*driver|install(?:ation)?\s*driver|driver\s*install(?:ation)?)/i,
    handler: handleWindowsDriverLink
  },
  {
    // Matches driver configuration, speed, darkness, density, dpi, resolution,
    // driver properties, printer preferences, advanced settings, calibration, etc.
    pattern: /(?:tsc.*driver.*config(?:uration)?|driver.*config(?:uration)?|configure.*driver|advanced? settings|driver properties|printer preferences|preferences|adjust.*(?:speed|darkness|density|dpi|resolution)|(?:lighter|darker|light|dark).*(?:print|printout)|fade(?:d)?|fading|calibrat(?:e|ion)|print faint|quality settings)/i,
    handler: handleDriverConfig
  },
  {
    // Printer model codes only
    pattern: /\btsc\s*[\w-]*\d+\b/i,
    handler: async (from, text) => {
      const model = extractPrinterModel(text);
      setUserModel(from, model);
      return `Got it! I'll remember your printer model: ${model}`;
    }
  },
];

// Main routing: enforce model-first then dispatch
async function routeIncoming(from, text) {
  const storedModel = getUserModel(from);
  if (!storedModel && !/\btsc\s*[\w-]*\d+\b/i.test(text)) {
    return 'Please tell me your printer model first (e.g. "TSC TTP-247"), so I can assist you properly.';
  }
  for (const { pattern, handler } of commandHandlers) {
    if (pattern.test(text)) {
      return handler(from, text);
    }
  }
  return handleGPT4Inquiry(from, text);
}

// Generate reply: optionally transcribe audio, then dispatch
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
  return routeIncoming(from, message);
}

// Webhook entrypoint
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

// --- Handlers ---

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

async function handleGPT4Inquiry(from, text) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [{ role: 'user', content: text }],
  });
  return completion.choices[0].message.content;
}

// --- WhatsApp sender ---

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
