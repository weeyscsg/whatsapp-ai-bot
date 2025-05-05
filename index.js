
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Cloudinary setup (if needed)
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

// Incoming WhatsApp message
app.post('/webhook', async (req, res) => {
  console.log("RAW WEBHOOK DATA:", JSON.stringify(req.body, null, 2)); // Debug log

  try {
    const messageObject = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!messageObject || messageObject.type !== 'text') {
      console.log("Not a text message from user. Ignoring.");
      return res.sendStatus(200);
    }

    const message = messageObject.text.body;
    const from = messageObject.from;

    // Keyword-based fast response for TSC software installation
    const triggerKeywords = ["install", "setup", "software", "bartender"];
    const lowerMessage = message.toLowerCase();

    const matchesTSCInstall = triggerKeywords.some(keyword =>
      lowerMessage.includes(keyword) && lowerMessage.includes("tsc")
    );

    if (matchesTSCInstall) {
      const tutorialLink = "Sure! You can follow this tutorial to install BarTender software for any TSC desktop or industrial printer:\nhttps://wa.me/p/25438061125807295/60102317781";

      await axios.post(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        to: from,
        text: { body: tutorialLink }
      }, {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      return res.sendStatus(200); // Stop GPT fallback
    }

    // GPT-4 Turbo response fallback
    const systemPrompt = `
You are a support assistant for Zebra and TSC barcode printers.
If the user asks about installing software for any TSC desktop or industrial printer, reply:
"Sure! You can follow this tutorial to install BarTender software:\nhttps://wa.me/p/25438061125807295/60102317781"
Otherwise, answer in a helpful and concise way.
`;

    let gptReply = "Hi! How can I assist you with your printer?";

    try {
      const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      gptReply = openaiResponse.data.choices?.[0]?.message?.content || gptReply;

    } catch (err) {
      console.error("Error calling OpenAI:", err.response?.data || err.message);
    }

    // Send GPT reply back to user
    await axios.post(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      text: { body: gptReply }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    res.sendStatus(200);

  } catch (err) {
    console.error("Unexpected error in /webhook:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Bot server is running on port ${PORT}`);
});
ECHO is on.
