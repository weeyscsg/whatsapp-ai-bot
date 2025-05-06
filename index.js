
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const fs = require('fs');
const whisper = require('node-whisper');
const path = require('path');

const app = express();
app.use(bodyParser.json());
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sessionMemory = {};
const SESSION_TTL = 48 * 60 * 60 * 1000; // 48 hours

function resetSessionIfExpired(from) {
  if (sessionMemory[from]) {
    const now = Date.now();
    const lastSeen = sessionMemory[from].timestamp;
    if (now - lastSeen > SESSION_TTL) {
      delete sessionMemory[from];
    }
  }
}

function updateSession(from, data = {}) {
  sessionMemory[from] = {
    ...sessionMemory[from],
    ...data,
    timestamp: Date.now(),
  };
}

function extractPrinterModel(message) {
  const match = message.match(/tsc\s*(\w+\d+)/i);
  return match ? match[0] : null;
}

async function transcribeAudio(mediaUrl) {
  const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
  const filePath = path.join(__dirname, 'temp.ogg');
  fs.writeFileSync(filePath, response.data);
  const result = await whisper.transcribe(filePath);
  return result.text;
}

async function generateReply({ from, body, audio }) {
  resetSessionIfExpired(from);

  let message = body;
  if (audio) {
    try {
      message = await transcribeAudio(audio);
    } catch (err) {
      return "Sorry, I couldn't process the audio. Please try again.";
    }
  }

  const model = extractPrinterModel(message);
  if (model) {
    updateSession(from, { printerModel: model });
  }

  const userSession = sessionMemory[from] || {};
  if (!userSession.printerModel) {
    updateSession(from);
    return "Before I assist, may I know your printer model?";
  }

  const printer = userSession.printerModel.toLowerCase();
  let systemPrompt = `You are a multilingual TSC/Zebra printer support bot. Printer model: ${printer}. Reply in the same language as the user's question. If the user asks about "driver", "install software", or "BarTender", suggest the correct tutorial link.`;

  const prompt = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  const chat = await openai.chat.completions.create({
    model: "gpt-4",
    messages: prompt,
  });

  return chat.choices[0].message.content;
}

app.post('/webhook', async (req, res) => {
  const { from, body, audio } = req.body;
  const reply = await generateReply({ from, body, audio });
  res.json({ reply });
});

app.listen(port, () => console.log(`Bot running on port ${port}`));
