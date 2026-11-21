import 'dotenv/config';
import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { detectClipMoments, transcribeAudioFile } from './server/ai.ts';
import {
  extractAudioForAI,
  generateAssSubtitleFile,
  probeVideo,
  renderVerticalClipMp4,
} from './server/ffmpeg.ts';
import { extractYouTubeId, fetchAndDownloadYouTube } from './server/youtube.ts';
import type {
  MomentCategory,
  SubtitleStyle,
  VideoJobInfo,
  WordToken,
} from './src/types/clip.ts';

const PORT = Number(process.env.PORT) || 3000;
const WORK_DIR = path.resolve('/tmp/clipkaro');
fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(path.join(WORK_DIR, 'uploads'), { recursive: true });

function getErrorStatus(msg: string): number {
  const lower = msg.toLowerCase();
  return lower.includes('temporarily busy') ||
    lower.includes('high demand') ||
    lower.includes('unavailable')
    ? 503
    : 500;
}

const ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

function safeResolve(baseDir: string, ...segments: string[]): string {
  const resolved = path.resolve(baseDir, ...segments);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid filesystem path.');
  }
  return resolved;
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

const jobStore = new Map<string, VideoJobInfo>();
const renderStore = new Map<string, { filePath: string; filename: string; size: number }>();

const upload = multer({
  dest: safeResolve(WORK_DIR, 'uploads'),
  limits: {
    fileSize: 400 * 1024 * 1024, // 400 MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-matroska',
      'application/octet-stream',
    ];
    if (allowed.includes(file.mimetype) || /\.(mp4|mov|webm|mkv)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload an MP4, MOV, WebM, or MKV video.'));
    }
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'ClipKaro AI' });
  });

  // 1. Analyze YouTube Link -> fetch metadata, transcript, and attempt MP4 download
  app.post('/api/video/analyze-url', async (req: Request, res: Response) => {
    try {
      const { url, category = 'All Viral Moments', targetDuration = 30 } = req.body as {
        url?: string;
        category?: MomentCategory;
        targetDuration?: number;
      };

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Please paste a valid YouTube video URL.' });
      }

      const videoId = extractYouTubeId(url);
      if (!videoId) {
        return res.status(400).json({
          error: 'Could not recognize a valid YouTube link. Supported formats: youtube.com/watch?v=..., youtu.be/..., or youtube.com/shorts/...',
        });
      }

      const jobId = makeId('job');
      const jobDir = safeResolve(WORK_DIR, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      const sourceVideoPath = safeResolve(jobDir, 'source.mp4');

      const ytResult = await fetchAndDownloadYouTube(videoId, sourceVideoPath);

      let width = 1920;
      let height = 1080;
      let duration = ytResult.duration;
      let transcriptSegments = ytResult.transcriptSegments;
      let detectedLanguage = 'English';

      // If video downloaded cleanly, probe dimensions & run AI audio transcription when captions aren't present
      if (ytResult.videoReady && fs.existsSync(sourceVideoPath)) {
        try {
          const probe = await probeVideo(sourceVideoPath);
          width = probe.width;
          height = probe.height;
          duration = probe.duration;
        } catch {
          // keep ytResult duration
        }

        if (transcriptSegments.length === 0) {
          const audioPath = safeResolve(jobDir, 'audio.mp3');
          try {
            await extractAudioForAI(sourceVideoPath, audioPath);
            const transcribed = await transcribeAudioFile(audioPath, duration);
            detectedLanguage = transcribed.detectedLanguage;
            transcriptSegments = transcribed.segments;
          } catch (transErr) {
            console.warn('Audio transcription fallback skipped:', transErr);
          }
        }
      }

      const safeTargetDuration = Math.max(5, Math.min(180, Number(targetDuration) || 30));
      const aiResult = await detectClipMoments({
        title: ytResult.title,
        channel: ytResult.channel,
        duration,
        transcriptSegments,
        detectedLanguage,
        category,
        targetDuration: safeTargetDuration,
      });

      const jobInfo: VideoJobInfo = {
        jobId,
        sourceType: 'youtube',
        youtubeUrl: ytResult.canonicalUrl,
        videoId: ytResult.videoId,
        title: ytResult.title,
        channel: ytResult.channel,
        thumbnailUrl: ytResult.thumbnailUrl,
        duration,
        width,
        height,
        videoReady: ytResult.videoReady,
        streamBlockedReason: ytResult.streamBlockedReason,
        detectedLanguage: aiResult.detectedLanguage,
        transcriptSegments,
        moments: aiResult.moments,
      };

      jobStore.set(jobId, jobInfo);
      return res.json(jobInfo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to analyze YouTube video.';
      return res.status(getErrorStatus(msg)).json({ error: msg });
    }
  });

  // 2. Upload Local Video File (standalone or attaching media to an existing YouTube jobId)
  app.post('/api/video/upload', upload.single('video'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No video file uploaded.' });
      }

      const existingJobId = typeof req.body.jobId === 'string' && ID_REGEX.test(req.body.jobId)
        ? req.body.jobId
        : null;
      const category = (req.body.category as MomentCategory) || 'All Viral Moments';
      const targetDuration = Math.max(5, Math.min(180, Number(req.body.targetDuration) || 30));

      const jobId = existingJobId && jobStore.has(existingJobId) ? existingJobId : makeId('job');
      const jobDir = safeResolve(WORK_DIR, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      const sourceVideoPath = safeResolve(jobDir, 'source.mp4');

      // Normalize uploaded video to MP4 path
      fs.renameSync(file.path, sourceVideoPath);

      const probe = await probeVideo(sourceVideoPath);
      const audioPath = safeResolve(jobDir, 'audio.mp3');

      let detectedLanguage = 'English';
      let transcriptSegments = jobStore.get(jobId)?.transcriptSegments ?? [];

      // Run AI speech transcription on the uploaded audio track
      try {
        await extractAudioForAI(sourceVideoPath, audioPath);
        const transcribed = await transcribeAudioFile(audioPath, probe.duration);
        detectedLanguage = transcribed.detectedLanguage;
        if (transcribed.segments.length > 0) {
          transcriptSegments = transcribed.segments;
        }
      } catch (err) {
        console.warn('Upload audio transcription warning:', err);
      }

      const existing = jobStore.get(jobId);
      const title = existing?.title ?? file.originalname.replace(/\.[^/.]+$/, '');
      const channel = existing?.channel ?? 'Uploaded Studio Video';

      const aiResult = await detectClipMoments({
        title,
        channel,
        duration: probe.duration,
        transcriptSegments,
        detectedLanguage,
        category,
        targetDuration,
      });

      const jobInfo: VideoJobInfo = {
        jobId,
        sourceType: existing ? existing.sourceType : 'upload',
        youtubeUrl: existing?.youtubeUrl,
        videoId: existing?.videoId,
        title,
        channel,
        thumbnailUrl: existing?.thumbnailUrl,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        videoReady: true,
        detectedLanguage: aiResult.detectedLanguage,
        transcriptSegments,
        moments: aiResult.moments,
      };

      jobStore.set(jobId, jobInfo);
      return res.json(jobInfo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Video upload processing failed.';
      return res.status(getErrorStatus(msg)).json({ error: msg });
    }
  });

  // 3. Re-detect Moments for Category / Duration Change
  app.post('/api/clips/detect', async (req: Request, res: Response) => {
    try {
      const { jobId, category, targetDuration } = req.body as {
        jobId?: string;
        category?: MomentCategory;
        targetDuration?: number;
      };

      if (!jobId || !ID_REGEX.test(jobId) || !jobStore.has(jobId)) {
        return res.status(404).json({ error: 'Video project session not found.' });
      }

      const job = jobStore.get(jobId)!;
      const safeTargetDuration = Math.max(5, Math.min(180, Number(targetDuration) || 30));

      const aiResult = await detectClipMoments({
        title: job.title,
        channel: job.channel,
        duration: job.duration,
        transcriptSegments: job.transcriptSegments,
        detectedLanguage: job.detectedLanguage,
        category: category || 'All Viral Moments',
        targetDuration: safeTargetDuration,
      });

      job.moments = aiResult.moments;
      job.detectedLanguage = aiResult.detectedLanguage;
      jobStore.set(jobId, job);

      return res.json(job);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to detect clip moments.';
      return res.status(getErrorStatus(msg)).json({ error: msg });
    }
  });

  // 4. Range-Enabled Source Video Stream for Browser Preview
  app.get('/api/video/stream/:jobId', (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      if (!ID_REGEX.test(jobId)) {
        return res.status(400).send('Invalid job ID');
      }

      const videoPath = safeResolve(WORK_DIR, jobId, 'source.mp4');
      if (!fs.existsSync(videoPath)) {
        return res.status(404).send('Source video not available');
      }

      const stat = fs.statSync(videoPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        if (Number.isNaN(start) || start >= fileSize || end >= fileSize) {
          return res.status(416).send('Requested range not satisfiable');
        }
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(videoPath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'video/mp4',
        });
        return stream.pipe(res);
      }

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      return fs.createReadStream(videoPath).pipe(res);
    } catch {
      return res.status(500).send('Stream error');
    }
  });

  // 5. Render 9:16 1080x1920 MP4 with FFmpeg Auto-Crop + Burned-in Lyrical ASS Subtitles
  app.post('/api/clips/render', async (req: Request, res: Response) => {
    try {
      const { jobId, title, startTime, endTime, cropPan, words, style } = req.body as {
        jobId?: string;
        title?: string;
        startTime?: number;
        endTime?: number;
        cropPan?: number;
        words?: WordToken[];
        style?: SubtitleStyle;
      };

      if (!jobId || !ID_REGEX.test(jobId)) {
        return res.status(400).json({ error: 'Invalid project jobId.' });
      }

      const sourcePath = safeResolve(WORK_DIR, jobId, 'source.mp4');
      if (!fs.existsSync(sourcePath)) {
        return res.status(404).json({
          error: 'Source video file is required to render MP4. Upload the video file to export 1080p MP4.',
        });
      }

      const safeStart = Math.max(0, Number(startTime) || 0);
      const safeEnd = Math.max(safeStart + 2, Number(endTime) || safeStart + 30);
      const duration = Math.min(240, safeEnd - safeStart);
      const renderId = makeId('render');

      const renderDir = safeResolve(WORK_DIR, jobId, 'renders');
      fs.mkdirSync(renderDir, { recursive: true });

      const assPath = safeResolve(renderDir, `${renderId}.ass`);
      const outPath = safeResolve(renderDir, `${renderId}.mp4`);

      const defaultStyle: SubtitleStyle = {
        preset: 'lyrical-pop',
        font: 'Bricolage Grotesque',
        size: 'lg',
        position: 'bottom',
        textColor: '#FFFFFF',
        highlightColor: '#F59E0B',
        outlineColor: '#000000',
        uppercase: false,
        wordsPerLine: 3,
        ...style,
      };

      generateAssSubtitleFile({
        words: Array.isArray(words) ? words : [],
        style: defaultStyle,
        clipStartTime: safeStart,
        clipDuration: duration,
        outAssPath: assPath,
      });

      await renderVerticalClipMp4({
        sourcePath,
        outPath,
        assPath,
        startTime: safeStart,
        duration,
        cropPan: Number(cropPan) || 0,
      });

      const stat = fs.statSync(outPath);
      const safeFilenameSlug = (title || 'clipkaro-short')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'clipkaro-short';

      renderStore.set(renderId, {
        filePath: outPath,
        filename: `${safeFilenameSlug}-1080p.mp4`,
        size: stat.size,
      });

      return res.json({
        renderId,
        downloadUrl: `/api/clips/download/${renderId}`,
        filename: `${safeFilenameSlug}-1080p.mp4`,
        fileSize: stat.size,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'FFmpeg rendering failed.';
      return res.status(500).json({ error: msg });
    }
  });

  // 6. Download Rendered 1080p MP4
  app.get('/api/clips/download/:renderId', (req: Request, res: Response) => {
    try {
      const { renderId } = req.params;
      if (!ID_REGEX.test(renderId)) {
        return res.status(400).send('Invalid render ID');
      }
      const entry = renderStore.get(renderId);
      if (!entry || !fs.existsSync(entry.filePath)) {
        return res.status(404).send('Rendered clip expired or not found');
      }
      return res.download(entry.filePath, entry.filename);
    } catch {
      return res.status(500).send('Download error');
    }
  });

  // Ensure unmatched /api/* routes and upload/server errors always return JSON (never HTML)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      const message = err instanceof Error ? err.message : 'Internal server error.';
      return res.status(500).json({ error: message });
    }
    return next(err);
  });

  // Vite dev middleware (tsx dev) or production static assets (node server.ts / NODE_ENV=production)
  const distDir = path.resolve(process.cwd(), 'dist');
  const hasDistBuild = fs.existsSync(path.join(distDir, 'index.html'));
  const isTsxDev = process.execArgv.some((arg) => arg.includes('tsx'));
  const useProductionStatic =
    process.env.NODE_ENV === 'production' || (!isTsxDev && hasDistBuild);

  if (!useProductionStatic) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipKaro AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
