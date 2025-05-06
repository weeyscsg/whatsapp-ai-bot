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
    return false;
  }
  return true;
}

function setUserSoftware(from) {
  userSoftwares.set(from, { expires: Date.now() + 48 * 3600 * 1000 });
}

// Regex for multi-word TSC/Zebra models
const MODEL_REGEX = /\b(?:tsc|zebra)[\s\w-]*\d+\w*\b/i;

function extractPrinterModel(text) {
  const m = text.match(MODEL_REGEX);
  return m ? m[0] : null;
}

async function routeIncoming(from, text) {
  text = (text || '').trim();
  const hasModel = getUserModel(from);
  const hasSoftware = getUserSoftware(from);

  // Greeting
  if (/^(hi|hello)$/i.test(text)) {
    return 'Please tell me your printer model or Printing Software first (e.g. "TSC TTP-247" or "Seagull Bartender")';
  }

  // Printer model entry
  const model = extractPrinterModel(text);
  if (model) {
    setUserModel(from, model);
    return `Got it! I'll remember your printer model: ${model}`;
  }

  // Printing software request
  if (/software|printing software/i.test(text)) {
    if (!hasModel) {
      return 'Please tell me your printer model first (e.g. "TSC TTP-247"), then ask for software.';
    }
    setUserSoftware(from);
    if (/tsc/i.test(hasModel)) {
      return "Here's your TSC Bartender software link:
https://wa.me/p/25438061125807295/60102317781";
    }
    return handleGPT4Inquiry(from, `Find the official download URL for the Zebra ${hasModel} labeling software.`);
  }

  // Printer driver request
  if (/\b(driver|printer driver|download driver)\b/i.test(text)) {
    if (!hasModel) {
      return 'Please tell me your printer model first (e.g. "TSC TTP-247"), then ask for a driver.';
    }
    if (/tsc/i.test(hasModel)) {
      return 'Download TSC drivers here: https://wa.me/p/7261706730612270/60102317781';
    }
    return handleGPT4Inquiry(from, `Please find the official download URL for the ${hasModel} printer driver.`);
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

app.post('/webhook', async (req, res) => {
  const messages = req.body.entry
    .flatMap(e => e.changes)
    .flatMap(c => c.value.messages || []);
  for (const msg of messages) {
    const reply = await routeIncoming(msg.from, msg.text?.body);
    if (reply) {
      await axios.post(
        `https://graph.facebook.com/v15.0/${process.env.PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', to: msg.from, text: { body: reply } },
        { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
      );
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
