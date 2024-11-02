// minimal-server.js
import dotenv from 'dotenv';
dotenv.config();

import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

const wss = new WebSocketServer({ port: 8001 });

// Function to create OpenAI realtime connection
const createOpenAIConnection = () => {
  console.log('\n=== Attempting OpenAI Realtime Connection ===');
  console.log('Connecting to:', "wss://api.openai.com/v1/realtime");
  
  const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
  const ws = new WebSocket(url, {
    headers: {
      "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  ws.on('open', () => {
    console.log('=== OpenAI Realtime Connection Successful ===');
    console.log('Model: gpt-4o-realtime-preview-2024-10-01');
  });

  ws.on('error', (error) => {
    console.error('=== OpenAI Realtime Connection Error ===');
    console.error('Error details:', error);
  });

  return ws;
};

wss.on('connection', (clientWs) => {
  console.log('\n=== New Client Connection ===');
  let openaiWs = null;

  clientWs.on('message', async (message) => {
    try {
      console.log('\n=== Received Client Message ===');
      console.log('Message:', message.toString());
      
      const data = JSON.parse(message.toString());
      
      if (data.type === 'session.create') {
        console.log('\n=== Initializing OpenAI Realtime Session ===');
        openaiWs = createOpenAIConnection();

        openaiWs.on('open', () => {
          console.log('\n=== Sending Initial OpenAI Configuration ===');
          const initMessage = {
            type: "response.create",
            response: {
              modalities: ["text"],
              instructions: "Please assist the user.",
            }
          };
          console.log('Init message:', JSON.stringify(initMessage, null, 2));
          openaiWs.send(JSON.stringify(initMessage));
        });

        openaiWs.on('message', (openaiMessage) => {
          console.log('\n=== Received OpenAI Message ===');
          console.log('Message:', openaiMessage.toString());
          clientWs.send(openaiMessage.toString());
        });
      }
    } catch (error) {
      console.error('\n=== Error Processing Message ===');
      console.error('Error:', error);
    }
  });

  clientWs.on('close', () => {
    console.log('\n=== Client Disconnected ===');
    if (openaiWs) {
      openaiWs.close();
    }
  });
});

console.log('\n=== WebSocket Server Started ===');
console.log('Server running on port 8001');