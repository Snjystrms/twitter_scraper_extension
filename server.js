// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        const allowedOrigins = [
            'chrome-extension://*',
            'https://twitter.com',
            'https://x.com',
            'http://localhost:3000'
        ];

        const isAllowed = allowedOrigins.some(pattern => {
            if (pattern.includes('*')) {
                return origin.startsWith(pattern.replace('*', ''));
            }
            return origin === pattern;
        });

        if (isAllowed) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const DATA_DIR = path.join(__dirname, 'data');
const UNIQUE_TWEETS_FILE = path.join(DATA_DIR, 'unique_tweets.json');
const MAX_TWEETS_PER_REQUEST = 100;

async function ensureDataDirectory() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        console.log('Data directory ensured');
    } catch (error) {
        console.error('Error creating data directory:', error);
        throw error;
    }
}

async function readExistingTweets() {
    try {
        const file = await fs.readFile(UNIQUE_TWEETS_FILE, 'utf8');
        return new Set(JSON.parse(file));
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('No existing tweets file found, creating new set');
            return new Set();
        }
        console.error('Error reading existing tweets:', error);
        throw error;
    }
}

async function saveUniqueTweets(uniqueTweetIds) {
    try {
        const backupFile = `${UNIQUE_TWEETS_FILE}.backup`;

        try {
            await fs.copyFile(UNIQUE_TWEETS_FILE, backupFile);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Error creating backup:', error);
            }
        }

        await fs.writeFile(
            UNIQUE_TWEETS_FILE,
            JSON.stringify(Array.from(uniqueTweetIds)),
            'utf8'
        );

        console.log(`Saved ${uniqueTweetIds.size} unique tweet IDs`);
    } catch (error) {
        console.error('Error saving unique tweets:', error);
        throw error;
    }
}

function generateTweetHash(tweet) {
    if (!tweet || !tweet.tweetId || !tweet.text) {
        console.warn('Invalid tweet data for hash generation');
        return null;
    }

    const hashInput = JSON.stringify({
        tweetId: tweet.tweetId,
        text: tweet.text.trim(),
        timestamp: tweet.timestamp
    });

    return crypto.createHash('md5').update(hashInput).digest('hex');
}

function validateTweet(tweet) {
    if (!tweet || !tweet.tweetId) {
        console.warn('Tweet missing ID');
        return false;
    }

    const lowercaseText = tweet.text?.toLowerCase() || '';
    if (lowercaseText.includes('ad') || lowercaseText.includes('sponsored')) {
        console.warn('Tweet appears to be an ad or sponsored content');
        return false;
    }

    tweet.images = Array.isArray(tweet.images) ? tweet.images : [];
    tweet.video = Array.isArray(tweet.video) ? tweet.video : [];

    return true;
}

// Queue System
const tweetQueue = [];
let isProcessing = false;

async function processQueue() {
    if (isProcessing || tweetQueue.length === 0) return;

    isProcessing = true;
    const { tweets, res } = tweetQueue.shift();

    try {
        await ensureDataDirectory();

        const uniqueTweetIds = await readExistingTweets();
        const trimmedTweets = tweets.slice(0, MAX_TWEETS_PER_REQUEST);
        const validTweets = trimmedTweets.filter(validateTweet);

        const newUniqueTweets = validTweets.filter(tweet => {
            const tweetHash = generateTweetHash(tweet);
            if (tweetHash && !uniqueTweetIds.has(tweetHash)) {
                uniqueTweetIds.add(tweetHash);
                return true;
            }
            return false;
        });

        if (newUniqueTweets.length === 0) {
            res.status(200).json({
                message: 'No new unique tweets',
                count: 0
            });
        } else {
            await saveUniqueTweets(uniqueTweetIds);

            const filename = path.join(DATA_DIR, `tweets_${Date.now()}.json`);
            await fs.writeFile(filename, JSON.stringify(newUniqueTweets, null, 2));

            console.log(`Saved ${newUniqueTweets.length} unique tweets to ${filename}`);
            res.status(200).json({
                message: 'Tweets stored successfully',
                count: newUniqueTweets.length,
                filename: path.basename(filename)
            });
        }
    } catch (error) {
        console.error('Error storing tweets:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    } finally {
        isProcessing = false;
        processQueue();
    }
}

app.post('/store-data', (req, res) => {
    if (!Array.isArray(req.body)) {
        return res.status(400).json({
            error: 'Invalid data format',
            received: typeof req.body
        });
    }

    tweetQueue.push({ tweets: req.body, res });
    processQueue();
});

app.get('/get-tweets', async (req, res) => {
    try {
        const files = await fs.readdir(DATA_DIR);
        const uniqueTweets = new Map();

        for (const file of files) {
            if (file.endsWith('.json') && file !== 'unique_tweets.json') {
                try {
                    const content = JSON.parse(
                        await fs.readFile(path.join(DATA_DIR, file), 'utf8')
                    );

                    content.forEach(tweet => {
                        if (validateTweet(tweet) && !uniqueTweets.has(tweet.tweetId)) {
                            uniqueTweets.set(tweet.tweetId, tweet);
                        }
                    });
                } catch (error) {
                    console.error(`Error processing file ${file}:`, error);
                    continue;
                }
            }
        }

        const tweets = Array.from(uniqueTweets.values())
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .map(tweet => ({
                tweetId: tweet.tweetId,
                timestamp: tweet.timestamp,
                name: tweet.name || 'Unknown User',
                username: tweet.username || '@unknown',
                verified_user: tweet.verified_user || 'no',
                text: tweet.text || 'No Text',
                comments: tweet.comments || '0',
                retweets: tweet.retweets || '0',
                likes: tweet.likes || '0',
                views: tweet.views || '0',
                images: tweet.images || [],
                video: tweet.video || []
            }));

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;

        const paginatedTweets = tweets.slice(startIndex, endIndex);

        res.json({
            total: tweets.length,
            page,
            limit,
            tweets: paginatedTweets
        });
    } catch (error) {
        console.error('Error retrieving tweets:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

app.options('*', cors());

app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({
        error: 'Unexpected server error',
        message: err.message
    });
});

const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('CORS enabled for Chrome extension and Twitter/X domains');
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Performing graceful shutdown...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    server.close(() => {
        process.exit(1);
    });
});

module.exports = app;
