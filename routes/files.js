const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const mm = require('music-metadata');

// Default music directories to scan
const DEFAULT_MUSIC_DIRS = [
    '/media',           // USB drives and external storage
    '/home/pi/Music',   // Default Pi user music folder
    path.join(__dirname, '../music') // Local music folder in the app
];

// Ensure local music directory exists
fs.ensureDirSync(path.join(__dirname, '../music'));

// Get list of directories
router.get('/directories', (req, res) => {
    try {
        // Return default directories that exist
        const existingDirs = DEFAULT_MUSIC_DIRS.filter(dir => fs.existsSync(dir));
        res.json({ directories: existingDirs });
    } catch (error) {
        console.error('Error getting directories:', error);
        res.status(500).json({ error: 'Error getting directories' });
    }
});

// List files and folders in a directory
router.get('/browse', async (req, res) => {
    try {
        const dirPath = req.query.path || DEFAULT_MUSIC_DIRS[0];

        if (!fs.existsSync(dirPath)) {
            return res.status(404).json({ error: 'Directory not found' });
        }

        const items = await fs.readdir(dirPath);
        const fileDetails = await Promise.all(items.map(async (item) => {
            const itemPath = path.join(dirPath, item);
            const stats = await fs.stat(itemPath);

            return {
                name: item,
                path: itemPath,
                isDirectory: stats.isDirectory(),
                size: stats.size,
                modified: stats.mtime
            };
        }));

        // Sort directories first, then files
        fileDetails.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        res.json({
            path: dirPath,
            items: fileDetails
        });
    } catch (error) {
        console.error('Error browsing files:', error);
        res.status(500).json({ error: 'Error browsing files' });
    }
});

// Get metadata for a specific audio file
router.get('/metadata', async (req, res) => {
    try {
        const filePath = req.query.path;

        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const metadata = await mm.parseFile(filePath);

        res.json({
            title: metadata.common.title || path.basename(filePath, path.extname(filePath)),
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            year: metadata.common.year,
            duration: metadata.format.duration,
            path: filePath,
            chapters: metadata.common.chapters
        });
    } catch (error) {
        console.error('Error getting metadata:', error);
        res.status(500).json({ error: 'Error getting metadata' });
    }
});

// Scan directory for MP3 and M4B files
router.post('/scan', async (req, res) => {
    try {
        const dirPath = req.body.path || DEFAULT_MUSIC_DIRS[0];

        if (!fs.existsSync(dirPath)) {
            return res.status(404).json({ error: 'Directory not found' });
        }

        // Recursively find all audio files
        const audioFiles = [];

        async function scanDir(dir) {
            const items = await fs.readdir(dir);

            for (const item of items) {
                const itemPath = path.join(dir, item);
                const stats = await fs.stat(itemPath);

                if (stats.isDirectory()) {
                    await scanDir(itemPath);
                } else {
                    const ext = path.extname(itemPath).toLowerCase();
                    if (ext === '.mp3' || ext === '.m4b') {
                        try {
                            const metadata = await mm.parseFile(itemPath);
                            const fileData = {
                                path: itemPath,
                                title: metadata.common.title || path.basename(itemPath, ext),
                                artist: metadata.common.artist || 'Unknown Artist',
                                album: metadata.common.album || 'Unknown Album',
                                duration: metadata.format.duration,
                                chapters: metadata.common.chapters
                            };
                            audioFiles.push(fileData);
                        } catch (err) {
                            console.error(`Error processing ${itemPath}:`, err);
                            // Add file with minimal info if metadata parsing fails
                            audioFiles.push({
                                path: itemPath,
                                title: path.basename(itemPath, ext),
                                artist: 'Unknown Artist',
                                album: 'Unknown Album'
                            });
                        }
                    }
                }
            }
        }

        await scanDir(dirPath);

        res.json({
            directory: dirPath,
            files: audioFiles
        });
    } catch (error) {
        console.error('Error scanning directory:', error);
        res.status(500).json({ error: 'Error scanning directory' });
    }
});

// Serve an audio file
router.get('/stream', (req, res) => {
    try {
        const filePath = req.query.path;

        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        const mimeType = path.extname(filePath).toLowerCase() === '.m4b' ? 'audio/mp4' : 'audio/mpeg';

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': mimeType
            });

            file.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': mimeType
            });

            fs.createReadStream(filePath).pipe(res);
        }
    } catch (error) {
        console.error('Error streaming file:', error);
        res.status(500).json({ error: 'Error streaming file' });
    }
});

module.exports = router;