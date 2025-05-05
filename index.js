
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const { OpenAI } = require("openai");
const { fileURLToPath } = require("url");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(bodyParser.json());
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const phoneUserMemory = {};

function clearExpiredMemory() {
    const now = new Date();
    for (const phone in phoneUserMemory) {
        if (now - phoneUserMemory[phone].timestamp > 48 * 60 * 60 * 1000) {
            delete phoneUserMemory[phone];
        }
    }
}

setInterval(clearExpiredMemory, 60 * 60 * 1000); // check every hour

function getUserPrinterModel(phone) {
    const entry = phoneUserMemory[phone];
    if (!entry || (new Date() - entry.timestamp > 48 * 60 * 60 * 1000)) {
        delete phoneUserMemory[phone];
        return null;
    }
    return entry.model;
}

function setUserPrinterModel(phone, model) {
    phoneUserMemory[phone] = { model: model, timestamp: new Date() };
}

async function handleMessage(from, text) {
    const model = getUserPrinterModel(from);
    const lowerText = text.toLowerCase();

    if (!model) {
        if (/tsc|zebra|printer|model/.test(lowerText)) {
            return "Before I assist, may I know your printer model?";
        } else if (/te200|tx200|tx600|t4000|tsc/i.test(lowerText)) {
            setUserPrinterModel(from, text.trim());
            return `Thanks! Got it. You're using: ${text.trim()}. How can I assist you today?`;
        } else {
            return "It’s been a while since we last spoke. Could you please tell me your printer model again so I can assist you better?";
        }
    }

    if (/install.*driver|download.*tsc.*driver/i.test(lowerText)) {
        return "You can follow this tutorial to install the official Windows driver for any TSC printer: https://wa.me/p/7261706730612270/60102317781";
    }

    if (/install.*bartender|how.*to.*install.*software/i.test(lowerText)) {
        return "Sure! You can follow this tutorial to install BarTender software: https://wa.me/p/25438061125807295/60102317781";
    }

    if (/light|faint|print.*not.*clear|not.*dark/i.test(lowerText)) {
        return "You can refer to this guide to configure darkness and speed for your TSC printer: https://wa.me/p/8073532716014276/60102317781";
    }

    return "Yes, I'm here to help! What do you need assistance with today?";
}

app.post("/webhook", async (req, res) => {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body;

    if (text) {
        const reply = await handleMessage(from, text);
        await axios.post("https://graph.facebook.com/v19.0/" + process.env.PHONE_NUMBER_ID + "/messages", {
            messaging_product: "whatsapp",
            to: from,
            text: { body: reply },
        }, {
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                "Content-Type": "application/json",
            }
        });
    }

    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
