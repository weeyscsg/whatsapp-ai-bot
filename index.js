import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

const app = express();
app.use(bodyParser.json());

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory store for user printer models
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
  userModels.set(from, { model, expires: Date.now() + 48 * 3600 * 1000 });
}

// Extract TSC or Zebra model codes
function extractPrinterModel(message) {
  const match = message.match(/\b(?:tsc|zebra)\s*[\w-]*\d+\b/i);
  return match ? match[0] : null;
}

// Handlers mapping
const commandHandlers = [
  { pattern: /\b(hi|hello)\b/i, handler: handleGreeting },
  { pattern: /\b(driver|download driver)\b/i, handler: handleDriverDownload },
  { pattern: /(?:software|download.*software)/i, handler: handleSoftwareLink },
  { pattern: /(?:windows?.*driver|install(?:ation)?.*driver)/i, handler: handleWindowsDriverLink },
  { pattern: /(?:driver.*config|configure.*driver|advanced? settings|adjust.*(?:speed|darkness|dpi|resolution)|fade(?:d)?|fading|calibrat(?:e|ion))/i, handler: handleDriverConfig },
  { pattern: /\b(?:tsc|zebra)\s*[\w-]*\d+\b/i,
    handler: async (from, text) => {
      const model = extractPrinterModel(text);
      setUserModel(from, model);
      return `Got it! I'll remember your printer model: ${model}`;
    }
  },
];

// Main routing
async function routeIncoming(from, text) {
  const stored = getUserModel(from);
  const found = extractPrinterModel(text);
  if (!stored && !found) {
    return 'Please tell me your printer model first (e.g. "TSC TTP-247" or "Zebra GK420d"), so I can assist you properly.';
  }
  for (const { pattern, handler } of commandHandlers) {
    if (pattern.test(text)) {
      return handler(from, text);
    }
  }
  return handleGPT4Inquiry(from, text);
}

// Generate reply
async function generateReply({ from, body, audio }) {
  let message = (body || '').trim();
  if (audio) {
    try {
      const { transcribeAudio } = await import('node-whisper');
      message = await transcribeAudio(audio);
    } catch {}
  }
  return routeIncoming(from, message);
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const messages = req.body.entry.flatMap(e => e.changes).flatMap(c => c.value.messages || []);
  for (const msg of messages) {
    const reply = await generateReply({ from: msg.from, body: msg.text?.body, audio: msg.audio?.id });
    if (reply) await sendText(msg.from, reply);
  }
  res.sendStatus(200);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

// --- Handlers ---

async function handleGreeting() {
  return 'Hello! How can I assist you today?';
}

async function handleDriverDownload(from) {
  const model = getUserModel(from) || '';
  if (/tsc/i.test(model)) {
    return 'Download TSC drivers here: https://wa.me/p/7261706730612270/60102317781';
  }
  return handleGPT4Inquiry(from, `Please find the official download URL for the ${model} printer driver.`);
}

async function handleSoftwareLink(from) {
  const model = getUserModel(from) || '';
  if (/tsc/i.test(model)) {
    return "Here's your TSC Bartender software link:
https://wa.me/p/25438061125807295/60102317781";
  }
  return handleGPT4Inquiry(from, `Please find the official download URL for the ${model} labeling software.`);
}

async function handleWindowsDriverLink(from) {
  const model = getUserModel(from) || '';
  if (/tsc/i.test(model)) {
    return "Here's the TSC Windows driver link: https://wa.me/p/7261706730612270/60102317781";
  }
  return handleGPT4Inquiry(from, `Please find the official Windows driver download URL for the ${model}.`);
}

async function handleDriverConfig(from) {
  const model = getUserModel(from) || '';
  if (/tsc/i.test(model)) {
    // Hardcoded TE200 calibration link
    return 'To calibrate your TSC TE200, see: https://wa.me/p/8073532716014276/60102317781';
  }
  return handleGPT4Inquiry(from, `Please provide configuration & calibration steps for the ${model} printer.`);
}

async function handleGPT4Inquiry(from, userText) {
  const model = getUserModel(from);
  const systemPrompt = model
    ? `You are a printer support assistant. The user’s printer model is ${model}.`
    : 'You are a printer support assistant.';
  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
  });
  return completion.choices[0].message.content;
}

// Send WhatsApp message
async function sendText(to, msg) {
  try {
    await axios.post(
      `https://graph.facebook.com/v15.0/${process.env.PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to, text: { body: msg } },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
  } catch (error) {
    console.error('sendText error', error.response?.data || error);
  }
}
