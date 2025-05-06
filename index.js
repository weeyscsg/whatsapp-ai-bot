import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory store for user printer models and software
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
  userModels.set(from, { model, expires: Date.now() + 48*3600*1000 });
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
  userSoftwares.set(from, { software, expires: Date.now() + 48*3600*1000 });
}

// Regex patterns
const MODEL_REGEX = /\b(?:tsc|zebra)[\s\w-]*\d+\w*\b/i;
const SOFTWARE_NAME_REGEX = /\b(?:Seagull\s*Bartender|Label\s*Matrix|Teklyn)\b/i;
const CONFIG_REGEX = /(?:blur|light(?:ing)?|fade(?:d)?|speed\s*(?:slow|fast)|darkness|dpi|resolution)/i;
const ERROR_REGEX = /(?:error\s*light|blinking|paper\s*jam|out\s*of\s*paper|no\s*paper|alignment|label\s*no\s*feed)/i;
const DRIVER_REGEX = /\b(?:driver|printer driver|download driver)\b/i;

// Extract functions
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
  text = (text||'').trim();
  const model = getUserModel(from);
  const software = getUserSoftware(from);

  // 1) Greeting
  if (/^(hi|hello)$/i.test(text)) {
    return 'Please tell me your printer model or Printing Software first (e.g. "TSC TTP-247" or "Seagull Bartender")';
  }

  // 2) Printer Model entry
  const detectedModel = extractPrinterModel(text);
  if (detectedModel) {
    setUserModel(from, detectedModel);
    return `Got it! I'll remember your printer model: ${detectedModel}`;
  }

  // 3) Software entry
  const detectedSoftware = extractSoftwareName(text);
  if (detectedSoftware) {
    setUserSoftware(from, detectedSoftware);
    return `Got it! I'll remember your printing software: ${detectedSoftware}`;
  }

  // 4) Driver configuration keywords
  if (CONFIG_REGEX.test(text)) {
    if (!model) {
      return 'Please tell me your printer model first (e.g. "TSC TTP-247") before configuration queries.';
    }
    if (/tsc/i.test(model)) {
      return `For printer driver configuration (speed, darkness, print quality) for your ${model}, see:
https://wa.me/p/8073532716014276/60102317781`;
    }
    // fallback to GPT
    return handleGPT4Inquiry(from, `Provide driver configuration steps for the ${model} printer.`);
  }

  // 5) Error/jam keywords
  if (ERROR_REGEX.test(text)) {
    if (!model) {
      return 'Please tell me your printer model first (e.g. "TSC TTP-247") before troubleshooting.';
    }
    if (/tsc/i.test(model)) {
      return `For paper jams, out-of-paper, alignment issues, or error-light on your ${model}, see:
https://wa.me/p/6828296190606265/60102317781`;
    }
    return handleGPT4Inquiry(from, `Provide troubleshooting steps for the ${model} printer (jams, error lights).`);
  }

  // 6) Driver download request
  if (DRIVER_REGEX.test(text)) {
    if (!model) {
      return 'Please tell me your printer model first before asking for a driver.';
    }
    if (/tsc/i.test(model)) {
      return 'Download TSC drivers here: https://wa.me/p/7261706730612270/60102317781';
    }
    return handleGPT4Inquiry(from, `Find the official download URL for the ${model} printer driver.`);
  }

  // 7) Software follow-up (handled by GPT4 with software context)
  if (software) {
    return handleGPT4Inquiry(from, text);
  }

  // 8) Fallback
  return 'Please tell me your printer model or Printing Software first (e.g. "TSC TTP-247" or "Seagull Bartender")';
}

// GPT-4 helper
async function handleGPT4Inquiry(from, userText) {
  const model = getUserModel(from);
  const software = getUserSoftware(from);
  const systemLines = ['You are a printer support assistant.'];
  if (model) systemLines.push(`Printer model: ${model}.`);
  if (software) systemLines.push(`Printing software: ${software}.`);
  const resp = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [
      { role:'system', content: systemLines.join(' ') },
      { role:'user', content: userText }
    ]
  });
  return resp.choices[0].message.content;
}

// Webhook
app.post('/webhook', async (req, res) => {
  const msgs = req.body.entry
    .flatMap(e=>e.changes)
    .flatMap(c=>c.value.messages||[]);
  for (const m of msgs) {
    const reply = await routeIncoming(m.from, m.text?.body);
    if (reply) {
      await axios.post(
        `https://graph.facebook.com/v15.0/${process.env.PHONE_NUMBER_ID}/messages`,
        { messaging_product:'whatsapp', to:m.from, text:{ body:reply } },
        { headers:{ Authorization:\`Bearer ${process.env.WHATSAPP_TOKEN}\` } }
      );
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT||3000;
app.listen(PORT, ()=>console.log(\`Bot running on port \${PORT}\`));
