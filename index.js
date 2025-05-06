import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Memory stores
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

// Regex for printer models
const MODEL_REGEX = /\b(?:tsc|zebra)[\s\w-]*\d+\w*\b/i;

// Extracts model string
function extractPrinterModel(text) {
  const m = text.match(MODEL_REGEX);
  return m ? m[0] : null;
}

async function routeIncoming(from, text) {
  text = (text || '').trim();
  const hasModel = getUserModel(from);
  const hasSoftware = getUserSoftware(from);

  // Greeting: prompt for model or software
  if (/^(hi|hello)$/i.test(text)) {
    return 'Please tell me your printer model or Printing Software first (e.g. "TSC TTP-247" or "Seagull Bartender")';
  }

  // Model entry
  const model = extractPrinterModel(text);
  if (model) {
    setUserModel(from, model);
    return `Got it! I'll remember your printer model: ${model}`;
  }

  // Software request
  if (/software|printing software/i.test(text)) {
    if (!hasModel) {
      return 'Please tell me your printer model first (e.g. "TSC TTP-247"), then ask for software.';
    }
    setUserSoftware(from);
    if (/tsc/i.test(hasModel)) {
      // Fixed single-line string with 
      return "Here's your TSC Bartender software link:\nhttps://wa.me/p/25438061125807295/60102317781";
    }
    return handleGPT4Inquiry(from, `Find the official download URL for the Zebra ${hasModel} labeling software.`);
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
  const msgs = req.body.entry
    .flatMap(e => e.changes)
    .flatMap(c => c.value.messages || []);
  for (const m of msgs) {
    const reply = await routeIncoming(m.from, m.text?.body);
    if (reply) {
      await axios.post(
        `https://graph.facebook.com/v15.0/${process.env.PHONE_NUMBER_ID}/messages`,
        { messaging_product:'whatsapp', to: m.from, text: { body: reply } },
        { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
      );
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));