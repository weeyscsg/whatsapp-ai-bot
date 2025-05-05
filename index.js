require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(bodyParser.json());

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

app.post('/webhook', async (req, res) => {
  const message = req.body.message?.text?.body || '';
  const from = req.body.message?.from;

  let reply = "Hi! I’m your Zebra/TSC printer support bot. Please describe your issue.";

  if (message.toLowerCase().includes("blur")) {
    reply = "Your print looks blurry? Follow this tutorial to increase the printer darkness: [PDF link or steps].";
  }

  if (from) {
    await axios.post(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: from,
      text: { body: reply }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Bot is running on port ${process.env.PORT}`);
});