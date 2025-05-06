import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory stores
const userModels = new Map();
const userSoftwares = new Map();

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

function getUserSoftware(from) {
  const entry = userSoftwares.get(from);
  if (!entry || Date.now() > entry.expires) {
    userSoftwares.delete(from);
    return null;
  }
  return entry.software;
}

function setUserSoftware(from, software) {
  userSoftwares.set(from, { software, expires: Date.now() + 48 * 3600 * 1000 });
}

// Regexes
const MODEL_REGEX = /\b(?:tsc|zebra)[\s\w-]*\d+\w*\b/i;
const SOFTWARE_NAME_REGEX = /\b(?:Seagull\s+Bartender|Label\s*Matrix|Teklyn\s+Label\s*Matrix)\b/i;
const CONFIG_REGEX = /(?:blur|light(?:\b|ing)|fade(?:d)?|speed\s*(?:slow|fast)|darkness|dpi|resolution)/i;
const ERROR_REGEX = /(?:error\s*light|blinking|paper\s*jam|out\s*of\s*paper|no\s*paper|alignment|label\s*no\s*feed)/i;
const DRIVER_DOWNLOAD_REGEX = /\b(?:driver|printer driver|download driver)\b/i;

// Extractors
function extractPrinterModel(text) {
  const m = text.match(MODEL_REGEX);
  return m ? m[0] : null;
}
function extractSoftwareName(text) {
  const m = text.match(SOFTWARE_NAME_REGEX);
  return m ? m[0] : null;
}

// Main router
async function routeIncoming(from, text) {
  text = (text || '').trim();
  const model = getUserModel(from);
  const softwareSaved = getUserSoftware(from);

  // Greeting
  if (/^(hi|hello)$/i.test(text)) {
    return 'Please tell me your printer model or Printing Software first (e.g. "TSC TTP-247" or "Seagull Bartender")';
  }

  // Printer Model Entry
  const detectedModel = extractPrinterModel(text);
  if (detectedModel) {
    setUserModel(from, detectedModel);
    return `Got it! I'll remember your printer model: ${detectedModel}`;
  }

  // Software Entry
  const detectedSoftware = extractSoftwareName(text);
  if (detectedSoftware) {
    setUserSoftware(from, detectedSoftware);
    return `Got it! I'll remember your printing software: ${detectedSoftware}`;
  }

  // Printing Software request
  if (/software|printing software/i.test(text)) {
    if (!model && !softwareSaved) {
      return 'Please tell me your printer model or printing software first.';
    }
    // If TSC printer model saved
    if (model && /tsc/i.test(model)) {
      return `Here's your TSC Bartender software link:
https://wa.me/p/25438061125807295/60102317781`;
    }
    // If softwareSaved directly
    if (softwareSaved && /bartender|label matrix|teklyn/i.test(softwareSaved)) {
      return `Here's your ${softwareSaved} download link:
https://wa.me/p/25438061125807295/60102317781`;
    }
    return handleGPT4Inquiry(from, softwareSaved
      ? `Find download URL for ${softwareSaved}.`
      : `Find download URL for the Zebra ${model} labeling software.`);
  }

  // Driver configuration queries
  if (CONFIG_REGEX.test(text)) {
    if (!model) {
      return 'Please tell me your printer model first before configuration queries.';
    }
    return `For printer driver configuration (speed, darkness, print quality) for your ${model}, see:
https://wa.me/p/8073532716014276/60102317781`;
  }

  // Error/jam queries
  if (ERROR_REGEX.test(text)) {
    if (!model) {
      return 'Please tell me your printer model first before troubleshooting.';
    }
    return `For paper jams, out-of-paper, alignment issues, red/error-light on ${model} printers:
https://wa.me/p/6828296190606265/60102317781`;
  }

  // Driver Download requests
  if (DRIVER_DOWNLOAD_REGEX.test(text)) {
    if (!model) {
      return 'Please tell me your printer model first before asking for a driver.';
    }
    if (/tsc/i.test(model)) {
      return 'Download TSC drivers here: https://wa.me/p/7261706730612270/60102317781';
    }
    return handleGPT4Inquiry(from, `Find the official download URL for the ${model} printer driver.`);
  }

  // Fallback
  return 'Please tell me your printer model or Printing Software first (e.g. "TSC TTP-247" or "Seagull Bartender")';
}

async function handleGPT4Inquiry(from, userText) {
  const model = getUserModel(from);
  const systemPrompt = model
    ? `You are a printer support assistant. The user’s printer model is ${model}.`
    : 'You are a printer support assistant.';
  const resp = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
  });
  return resp.choices[0].message.content;
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const messages = req.body.entry
    .flatMap(e => e.changes)
    .flatMap(c => c.value.messages || []);
  for (const msg of messages) {
    const reply = await routeIncoming(msg.from, msg.text?.body);
    if (reply) {
      const url = `https://graph.facebook.com/v15.0/${process.env.PHONE_NUMBER_ID}/messages`;
      const token = process.env.WHATSAPP_TOKEN;
      await axios.post(
        url,
        { messaging_product: 'whatsapp', to: msg.from, text: { body: reply } },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }
  }
  res.sendStatus(200);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
