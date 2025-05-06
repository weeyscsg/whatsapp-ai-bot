import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory 48h model store
const userModels = new Map();
function getUserModel(from) {
  const e = userModels.get(from);
  if (!e || Date.now()>e.expires) return userModels.delete(from), null;
  return e.model;
}
function setUserModel(from, m) {
  userModels.set(from, { model: m, expires: Date.now()+48*3600*1000 });
}

// Extract only real TSC/Zebra model strings
function extractPrinterModel(msg) {
  const m = msg.match(/\b(?:tsc|zebra)\s*[\w-]*\d+\b/i);
  return m ? m[0] : null;
}

const commandHandlers = [
  { pattern: /\b(hi|hello)\b/i, handler: handleGreeting },
  { pattern: /\b(driver|download driver)\b/i, handler: handleDriverDownload },
  {
    pattern: /(?:software|download.*software)/i,
    handler: handleSoftwareLink
  },
  {
    pattern: /(?:windows?.*driver|install(?:ation)?.*driver)/i,
    handler: handleWindowsDriverLink
  },
  {
    pattern: /(?:driver.*config|configure.*driver|advanced? settings|adjust.*(?:speed|darkness|dpi|resolution)|fade(?:d)?|fading)/i,
    handler: handleDriverConfig
  },
  {
    pattern: /\b(?:tsc|zebra)\s*[\w-]*\d+\b/i,
    handler: async (from,text) => {
      const model = extractPrinterModel(text);
      setUserModel(from, model);
      return `Got it! I'll remember your printer model: ${model}`;
    }
  },
];

async function routeIncoming(from, text) {
  const stored = getUserModel(from);
  const found = extractPrinterModel(text);
  if (!stored && !found) {
    return 'Please tell me your printer model first (e.g. "TSC TTP-247" or "Zebra GK420d")…';
  }
  for (let {pattern,handler} of commandHandlers) {
    if (pattern.test(text)) return handler(from,text);
  }
  return handleGPT4Inquiry(from,text);
}

async function generateReply({from,body,audio}) {
  let msg = (body||'').trim();
  if (audio) {
    try { msg = await (await import('node-whisper')).transcribeAudio(audio); }
    catch{}  
  }
  return routeIncoming(from,msg);
}

app.post('/webhook', async (req,res) => {
  const msgs = req.body.entry.flatMap(e=>e.changes).flatMap(c=>c.value.messages||[]);
  for (let m of msgs) {
    const reply = await generateReply({ from:m.from, body:m.text?.body, audio:m.audio?.id });
    if (reply) await sendText(m.from,reply);
  }
  res.sendStatus(200);
});

app.listen(process.env.PORT||3000,()=>console.log('Bot up'));

// ── HANDLERS ─────────────────────────────────────────────
async function handleGreeting(){ return 'Hello! How can I assist you today?'; }

async function handleDriverDownload(from){
  const model = getUserModel(from)||'';
  if (/tsc/i.test(model)) return 'Download TSC drivers here: https://wa.me/p/7261706730612270/60102317781';
  if (/zebra/i.test(model)) return 'Download Zebra drivers here: https://www.zebra.com/us/en/support-downloads/drivers.html';
  return 'Here is a generic driver download page: https://wa.me/p/7261706730612270/60102317781';
}

async function handleSoftwareLink(from){
  const model = getUserModel(from)||'';
  if (/tsc/i.test(model)) {
    return "Here's your TSC Bartender software link:\nhttps://wa.me/p/25438061125807295/60102317781";
  }
  if (/zebra/i.test(model)) {
    return 'Here is the Zebra Labeling Software page: https://www.zebra.com/us/en/support-downloads/software.html';
  }
  return 'Please confirm your printer brand so I can send the correct software link.';
}

async function handleWindowsDriverLink(from){
  const model = getUserModel(from)||'';
  if (/tsc/i.test(model)) return "Here's the TSC Windows driver link: https://wa.me/p/7261706730612270/60102317781";
  if (/zebra/i.test(model)) return 'Here is the Zebra Windows driver: https://www.zebra.com/us/en/support-downloads/drivers.html';
  return 'Please confirm your printer brand so I can send the correct Windows driver link.';
}

async function handleDriverConfig(from){
  const model = getUserModel(from)||'';
  if (/tsc/i.test(model)) return 'For TSC driver config (speed/darkness), see: https://wa.me/p/8073532716014276/60102317781';
  if (/zebra/i.test(model)) return 'For Zebra driver config, see: https://www.zebra.com/us/en/support-downloads/knowledge-articles.html';
  return 'Please confirm your printer brand for the right configuration guide.';
}

async function handleGPT4Inquiry(from,text){
  const r = await openai.chat.completions.create({
    model:'gpt-4-turbo', messages:[{role:'user',content:text}]
  });
  return r.choices[0].message.content;
}

// ── SENDER ────────────────────────────────────────────────
async function sendText(to,msg){
  try{
    await axios.post(
      `https://graph.facebook.com/v15.0/${process.env.PHONE_NUMBER_ID}/messages`,
      { messaging_product:'whatsapp', to, text:{ body:msg } },
      { headers:{ Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
  }catch(e){ console.error('sendText error',e.response?.data||e); }
}
