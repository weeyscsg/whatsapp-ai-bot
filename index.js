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
  // Always default to a string
  let message = body || '';

  // Try audio transcription if provided
  if (audio) {
    try {
      const { transcribeAudio } = await import('node-whisper');
      message = await transcribeAudio(audio);
    } catch (err) {
      console.warn('Whisper transcription failed:', err);
    }
  }

  // Store printer model memory if mentioned
  const model = extractPrinterModel(message);
  if (model) {
    await handlePrinterModelMemory(from, model);
  }

  // Determine reply
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
      // Only send if we got a string back
      if (typeof reply === 'string' && reply.length) {
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
  return 'Download TSC drivers here: https://www.tscprinters.com/DriverDownload';
}
async function handleDriverConfig(from, text) {
  return 'Adjust speed/darkness under Advanced settings in your TSC driver.';
}
async function handleLightnessAdvice(from, text) {
  return 'If prints are too light, increase darkness by 1–2 levels in driver settings.';
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
