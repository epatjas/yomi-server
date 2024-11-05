// minimal-server.js
import dotenv from 'dotenv';
dotenv.config();

import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { convertToWhisperFormat } from './server/utils/audioConverter.js';
import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';

const wss = new WebSocketServer({ port: 8001 });

// Function to create OpenAI realtime connection
const createOpenAIConnection = (clientWs) => {
  console.log('\n=== Attempting OpenAI Realtime Connection ===');
  const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
  
  const ws = new WebSocket(url, {
    headers: {
      "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  ws.on('open', () => {
    console.log('=== OpenAI Realtime Connection Successful ===');
    
    // Send initial response creation message
    const initMessage = {
      type: 'response.create',
      response: {
        modalities: ["text", "audio"],
        instructions: "Please assist the user."
      }
    };
    ws.send(JSON.stringify(initMessage));
  });

  ws.on('error', (error) => {
    console.error('=== OpenAI Realtime Connection Error ===');
    console.error('Error details:', error);
  });

  ws.on('message', (message) => {
    console.log('OpenAI Response:', JSON.parse(message.toString()));
    clientWs.send(message.toString());  // Forward to client
  });

  return ws;
};

wss.on('connection', (ws) => {
  console.log('\n=== New Client Connection ===');
  let openaiWs = null;

  try {
    console.log('\n=== Attempting OpenAI Realtime Connection ===');
    // Construct URL with model query parameter
    const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
    
    openaiWs = new WebSocket(url, {
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    openaiWs.on('open', () => {
      console.log('=== OpenAI Realtime Connection Successful ===');
      
      // Update session configuration
      const sessionConfig = {
        type: "session.update",
        session: {
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          modalities: ["text", "audio"],
          instructions: "Please respond in Finnish language. Use standard Finnish dialect and pronunciation. Be friendly and natural in your responses.",
          voice: "shimmer"
        }
      };
      
      openaiWs.send(JSON.stringify(sessionConfig));
      console.log('Session configuration sent:', JSON.stringify(sessionConfig, null, 2));
    });

    // Add a flag to track active responses
    let hasActiveResponse = false;

    openaiWs.on('message', async (message) => {
      const data = JSON.parse(message.toString());
      
      // Log all message types for debugging
      console.log('\n=== OpenAI Message ===');
      console.log('Type:', data.type);
      
      // When conversation item is created and no active response
      if (data.type === 'conversation.item.created' && !hasActiveResponse) {
        console.log('Creating response...');
        hasActiveResponse = true;
        const createResponse = {
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            voice: 'shimmer'  // Explicitly set voice here too
          }
        };
        openaiWs.send(JSON.stringify(createResponse));
      }
      
      // When we receive audio from OpenAI
      if (data.type === 'response.audio.delta' && data.audio) {
        try {
          console.log('\n=== Converting OpenAI Audio ===');
          // Convert PCM to MP3 before sending to client
          const audioBuffer = Buffer.from(data.audio, 'base64');
          console.log('Original audio size:', audioBuffer.length);
          
          const mp3Buffer = await convertPCMToMP3(audioBuffer);
          console.log('Converted MP3 size:', mp3Buffer.length);
          
          // Send converted audio to client
          const modifiedMessage = {
            ...data,
            audio: mp3Buffer.toString('base64')
          };
          
          console.log('Sending audio to client');
          ws.send(JSON.stringify(modifiedMessage));
        } catch (error) {
          console.error('Error converting audio:', error);
          ws.send(message.toString());
        }
      } else {
        // Forward other messages as-is
        ws.send(message.toString());
      }
      
      // Handle text response
      if (data.type === 'response.audio_transcript.done') {
        console.log('Yomi Response:', data.transcript);
      }
      
      // Reset flag when response is done
      if (data.type === 'response.done') {
        hasActiveResponse = false;
      }
      
      // Handle errors
      if (data.type === 'error') {
        console.error('OpenAI Error:', data);
        hasActiveResponse = false;
      }
    });

    openaiWs.on('error', (error) => {
      console.error('OpenAI WebSocket error:', error);
    });

  } catch (error) {
    console.error('Failed to connect to OpenAI:', error);
  }

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('\n=== Received Message Type ===', data.type);

      if (data.type === 'message' && data.content.type === 'audio') {
        console.log('\n=== Processing Audio ===');
        console.log('Audio data length:', data.content.audio.length);
        
        const audioBuffer = Buffer.from(data.content.audio, 'base64');
        const processedAudio = await convertToWhisperFormat(audioBuffer);
        
        console.log('Processed audio size:', processedAudio.length);
        
        // Clear buffer
        openaiWs.send(JSON.stringify({
          type: 'input_audio_buffer.clear'
        }));
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Send audio in chunks if it's large
        const chunkSize = 16000 * 2; // 1 second of audio at 16kHz
        for (let i = 0; i < processedAudio.length; i += chunkSize) {
          const chunk = processedAudio.slice(i, i + chunkSize);
          openaiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: chunk.toString('base64')
          }));
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Commit
        openaiWs.send(JSON.stringify({
          type: 'input_audio_buffer.commit'
        }));
        
        console.log('Audio processing complete');
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Server error: ' + error.message
      }));
    }
  });

  // Reset flag when client disconnects
  ws.on('close', () => {
    console.log('\n=== Client Disconnected ===');
    hasActiveResponse = false;
    if (openaiWs) {
      openaiWs.close();
    }
  });
});

console.log('\n=== WebSocket Server Started ===');
console.log('Server running on port 8001');

async function convertPCMToMP3(pcmBuffer) {
  return new Promise((resolve, reject) => {
    const inputStream = new Readable();
    inputStream.push(pcmBuffer);
    inputStream.push(null);
    
    const chunks = [];
    
    ffmpeg(inputStream)
      .inputFormat('s16le')
      .inputOptions([
        '-ar 16000',
        '-ac 1',
        '-f s16le'
      ])
      .toFormat('mp3')
      .on('error', reject)
      .on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      })
      .on('data', chunk => chunks.push(chunk))
      .pipe();
  });
}