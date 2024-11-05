import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export async function convertToWhisperFormat(audioBuffer) {
  const tempInputPath = join(tmpdir(), `input-${Date.now()}.m4a`);
  const tempOutputPath = join(tmpdir(), `output-${Date.now()}.raw`);

  try {
    await fs.writeFile(tempInputPath, audioBuffer);

    return new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .audioChannels(1)
        .audioFrequency(16000)
        .audioCodec('pcm_s16le')
        .format('s16le')
        .on('start', (command) => {
          console.log('FFmpeg command:', command);
        })
        .on('end', async () => {
          try {
            const outputBuffer = await fs.readFile(tempOutputPath);
            console.log('Audio conversion successful, output size:', outputBuffer.length);
            await cleanup();
            resolve(outputBuffer);
          } catch (error) {
            await cleanup();
            reject(error);
          }
        })
        .on('error', async (error) => {
          console.error('FFmpeg error:', error);
          await cleanup();
          reject(error);
        })
        .save(tempOutputPath);
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  async function cleanup() {
    try {
      await fs.unlink(tempInputPath).catch(() => {});
      await fs.unlink(tempOutputPath).catch(() => {});
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  }
}