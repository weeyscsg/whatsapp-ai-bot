
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Webhook verification
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Multilingual system prompt
const systemPrompt = `
You are a support assistant for Zebra and TSC barcode printers.
You can understand and respond in:
- English
- Chinese (Simplified)
- Malay (Bahasa Melayu)

If the user asks about installing software for any TSC desktop or industrial printer, reply with the appropriate version below:

[EN]
"Sure! You can follow this tutorial to install BarTender software: https://wa.me/p/25438061125807295/60102317781"

[中文]
"当然！您可以通过这个 WhatsApp 教程链接安装 BarTender 软件： https://wa.me/p/25438061125807295/60102317781"

[BM]
"Sudah tentu! Anda boleh ikuti tutorial WhatsApp ini untuk memasang perisian BarTender: https://wa.me/p/25438061125807295/60102317781"

Always match the user's language. If unsure, reply in English.
`;

app.post('/webhook', async (req, res) => {
  console.log("RAW WEBHOOK DATA:", JSON.stringify(req.body, null, 2));
  try {
    const messageObject = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObject) return res.sendStatus(200);

    const from = messageObject.from;
    const type = messageObject.type;

    if (type === 'audio') {
      const mediaId = messageObject.audio.id;
      const mediaUrlRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
      });
      const mediaUrl = mediaUrlRes.data.url;

      const audioRes = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
      });

      fs.writeFileSync("/tmp/audio.ogg", Buffer.from(audioRes.data));
      const formData = new FormData();
      formData.append("file", fs.createReadStream("/tmp/audio.ogg"));
      formData.append("model", "whisper-1");

      const whisperRes = await axios.post("https://api.openai.com/v1/audio/transcriptions", formData, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        }
      });

      const transcribedText = whisperRes.data.text;

      const gptRes = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcribedText }
        ]
      }, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const reply = gptRes.data.choices?.[0]?.message?.content || "How can I assist you?";
      await axios.post(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply }
      }, {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      return res.sendStatus(200);
    }

    if (type === 'text') {
      const message = messageObject.text.body;
      const triggerKeywords = ["install", "setup", "software", "bartender"];
      const lowerMessage = message.toLowerCase();

      const configKeywords = ["driver", "configuration", "speed", "darkness"];
      const matchConfig = configKeywords.some(k => lowerMessage.includes(k) && lowerMessage.includes("tsc"));

      if (matchConfig) {
        const lang = lowerMessage.match(/[\u4e00-\u9fff]/) ? "zh" : lowerMessage.includes("sila") ? "bm" : "en";
        const driverMessage = {
          "en": "You can follow this tutorial for TSC driver and configuration settings (speed, darkness, etc): https://wa.me/p/8073532716014276/60102317781",
          "zh": "如果您需要设置 TSC 打印机的驱动程序、速度或浓度，请参考这个教程： https://wa.me/p/8073532716014276/60102317781",
          "bm": "Jika anda perlukan bantuan untuk tetapan driver atau kelajuan/cetakan TSC, sila rujuk tutorial ini: https://wa.me/p/8073532716014276/60102317781"
        }[lang];

        await axios.post(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
          messaging_product: "whatsapp",
          to: from,
          text: { body: driverMessage }
        }, {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        return res.sendStatus(200);
      }
      const matchesTSCInstall = triggerKeywords.some(k => lowerMessage.includes(k) && lowerMessage.includes("tsc"));

      if (matchesTSCInstall) {
        const tutorialLink = "Sure! You can follow this tutorial to install BarTender software for any TSC desktop or industrial printer: https://wa.me/p/25438061125807295/60102317781";
        await axios.post(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
          messaging_product: "whatsapp",
          to: from,
          text: { body: tutorialLink }
        }, {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        return res.sendStatus(200);
      }

      const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ]
      }, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const gptReply = openaiResponse.data.choices?.[0]?.message?.content || "Hi! How can I assist you with your printer?";
      await axios.post(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        to: from,
        text: { body: gptReply }
      }, {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      return res.sendStatus(200);
    }

    console.log("Unsupported message type");
    res.sendStatus(200);
  } catch (err) {
    console.error("Unexpected error in /webhook:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Bot server is running on port ${PORT}`);
});
