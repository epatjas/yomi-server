const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { OpenAI } = require('openai');
const fs = require('fs');
require('dotenv').config();

// Create an Express app
const app = express();
const port = process.env.PORT || 8000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// WebSocket connection handling
wss.on('connection', (clientWs) => {
    console.log('Client connected');

    let audioChunks = [];

    clientWs.on('message', async (message) => {
        try {
            let data = JSON.parse(message);

            if (data.type === 'audio') {
                audioChunks.push(Buffer.from(data.audio, 'base64'));
            } else if (data.type === 'end') {
                const audioBuffer = Buffer.concat(audioChunks);
                
                // Save the audio buffer to a temporary file
                const tempFilePath = './temp_audio.wav';
                fs.writeFileSync(tempFilePath, audioBuffer);

                const transcription = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(tempFilePath),
                    model: "whisper-1",
                    language: "en",
                });

                clientWs.send(JSON.stringify({ type: 'transcript', text: transcription.text }));

                // Clean up the temporary file
                fs.unlinkSync(tempFilePath);

                audioChunks = []; // Reset for next audio stream
            }
        } catch (error) {
            console.error('Error processing message:', error);
            clientWs.send(JSON.stringify({ type: 'error', message: 'Error processing message: ' + error.message }));
        }
    });

    clientWs.on('close', () => {
        console.log('Client disconnected');
    });
});

// Basic HTTP endpoint for testing
app.get('/', (req, res) => {
    res.send('Yomi WebSocket server is running');
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Replace the detailed OpenAI client log with a simple confirmation
console.log('OpenAI client initialized successfully');
