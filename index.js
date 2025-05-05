
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
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || '';
    const from = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

    if (!message || !from) {
      console.log("No valid message or sender found.");
      return res.sendStatus(200); // Acknowledge without action
    }

    // GPT-4 Turbo response
    let gptReply = "Hi! I’m your Zebra/TSC printer support bot. Please describe your issue.";

    try {
      const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You are a helpful support assistant for Zebra and TSC barcode printers." },
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

    // Send reply back to user via WhatsApp API
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
