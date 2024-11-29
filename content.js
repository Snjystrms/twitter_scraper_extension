// content.js
class TweetScraper {
    constructor() {
        this.scrapedData = new Map();
        this.sentTweetHashes = new Set();
      //  this.API_ENDPOINT = 'http://localhost:8000/add_users_tweets';
        this.isRunning = false;
        this.lastScroll = Date.now();
        this.processingQueue = Promise.resolve();
        this.batchSize = 5; // Reduced batch size for better reliability
        this.retryCount = 3;
        this.pendingTweets = new Set();
        this.rateLimiter = {
            lastSend: Date.now(),
            minInterval: 2000, // Increased to 2 seconds for better reliability
        };
        this.processedTweetIds = new Set();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.scrapeTweets();
        this.setupObserver();
        this.startPeriodicSend();
        this.setupScrollHandler();
        this.setupErrorRecovery();
        this.setupButtonInsertion(); // Add this line
        console.log('Tweet scraper started');
    }

    stop() {
        this.isRunning = false;
        if (this.observer) this.observer.disconnect();
        if (this.sendInterval) clearInterval(this.sendInterval);
        if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
        if (this.errorRecoveryInterval) clearInterval(this.errorRecoveryInterval);
        console.log('Tweet scraper stopped');
    }

    // New method to handle button insertion
    setupButtonInsertion() {
        console.log('Setting up button insertion...');
    
        const observerCallback = (mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    console.log('Mutation detected:', mutation.addedNodes);
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const articles = node.querySelectorAll('article');
                            console.log(`Found ${articles.length} new articles`);
                            articles.forEach(article => this.insertScraperButton(article));
                        }
                    });
                }
            });
        };
    
        const tweets = document.querySelectorAll('article');
        console.log(`Initial tweet count: ${tweets.length}`);
        tweets.forEach(tweet => this.insertScraperButton(tweet));
    
        const observer = new MutationObserver(observerCallback);
        observer.observe(document.body, { childList: true, subtree: true });
    }
    

    insertScraperButton(tweet) {
        // Check if button already exists
        if (tweet.querySelector('#scraperButton')) return;

        // Find the text element
        const textElement = tweet.querySelector('[data-testid="tweetText"]');
        if (!textElement) return;

        // Check if text contains "$" or "#"
        const text = textElement.innerText;
        if (!text.includes('$') && !text.includes('#')) return;

        // Find the user name div
        const userNameDiv = tweet.querySelector('[data-testid="User-Name"]');
        if (!userNameDiv) return;

        // Create button element
        const button = document.createElement('button');
        button.id = 'scraperButton';
        button.style.cssText = `
        z-index: 2147483647;
        border: none;
        background-color: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 20px;
        margin-left: 4px;
        position:relative;
        top:3px;  
    `;

        // Create image element
        const img = document.createElement('img');
        img.src = chrome.runtime.getURL('scraperbutton.png');
        img.alt = 'Scraper Button';
        img.style.height = '20px';

        // Append image to button
        button.appendChild(img);

        // Add click event listener (optional)
        button.addEventListener('click', () => {
            console.log('Scraper button clicked for tweet:', this.getTweetId(tweet));
            // Add any additional functionality you want when the button is clicked
        });

        // Insert button after the last child of the user name div
        const childDivs = userNameDiv.querySelectorAll('div');
        if (childDivs.length > 1) {
            const lastChildDiv = childDivs[childDivs.length - 1];
            lastChildDiv.after(button);
        }
    }

    setupScrollHandler() {
        let scrollThrottle;
        const throttleDelay = 500; // 500ms throttle

        const handleScroll = () => {
            if (!this.isRunning) return;
            
            this.lastScroll = Date.now();
            
            // Clear existing timeouts
            clearTimeout(this.scrollTimeout);
            clearTimeout(scrollThrottle);
            
            // Throttle scroll handling
            scrollThrottle = setTimeout(() => {
                // Check if we're near the bottom of the page
                const scrollPosition = window.scrollY + window.innerHeight;
                const documentHeight = document.documentElement.scrollHeight;
                const nearBottom = scrollPosition >= documentHeight - 1000;
                
                if (nearBottom) {
                    console.log('Near bottom of page, scraping new tweets');
                }
                
                this.scrollTimeout = setTimeout(() => {
                    if (Date.now() - this.lastScroll >= 500) {
                        this.scrapeTweets();
                    }
                }, 500);
            }, throttleDelay);
        };

        window.addEventListener('scroll', handleScroll);
    }

    setupErrorRecovery() {
        this.errorRecoveryInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.retryFailedScrapes();
        }, 30000); // Check every 30 seconds
    }

    async retryFailedScrapes() {
        const tweets = Array.from(document.querySelectorAll('article'));
        for (const tweet of tweets) {
            const tweetId = this.getTweetId(tweet);
            if (tweetId && !this.processedTweetIds.has(tweetId)) {
                await this.processSingleTweet(tweet);
            }
        }
    }

    async scrapeTweets() {
        if (!this.isRunning) return;

        try {
            const tweets = Array.from(document.querySelectorAll('article'));
            console.log(`Found ${tweets.length} tweets to process`);
            
            for (let i = 0; i < tweets.length; i += this.batchSize) {
                const batch = tweets.slice(i, i + this.batchSize);
                await this.processTweetBatch(batch);
            }
        } catch (error) {
            console.error('Error scraping tweets:', error);
        }
    }

    async processTweetBatch(tweets) {
        return new Promise(resolve => {
            this.processingQueue = this.processingQueue.then(async () => {
                for (const tweet of tweets) {
                    if (!this.isRunning) break;
                    await this.processSingleTweet(tweet);
                }
                resolve();
            });
        });
    }

    async processSingleTweet(tweet) {
        const tweetData = this.extractTweetData(tweet);
        if (!tweetData) {
            console.log('Could not extract tweet data');
            return;
        }
    
        const tweetHash = this.createTweetHash(tweetData);
        if (!tweetHash) {
            console.log('Could not create tweet hash');
            return;
        }
    
        console.log('Tweet ID:', tweetData.tweetId);
        console.log('Tweet Hash:', tweetHash);
    
        if (!this.sentTweetHashes.has(tweetHash) && 
            !this.pendingTweets.has(tweetHash)) {
            this.pendingTweets.add(tweetHash);
            this.scrapedData.set(tweetHash, tweetData);
            this.processedTweetIds.add(tweetData.tweetId);
            console.log('New tweet queued:', tweetData.tweetId);
        }
    }

    getTweetId(tweet) {
        try {
            const tweetLink = tweet.querySelector('a[href*="/status/"]');
            if (tweetLink) {
                const match = tweetLink.href.match(/status\/(\d+)/);
                if (match) {
                    const tweetId = match[1];
                    console.log('Tweet ID from link:', tweetId);
                    console.log('Tweet ID type:', typeof tweetId);
                    return tweetId; // Return as string to maintain exact ID
                }
            }
    
            return null;
        } catch (error) {
            console.error('Comprehensive error extracting tweet ID:', error);
            return null;
        }
    }

    extractTweetData(tweet) {
        try {
            const tweetId = this.getTweetId(tweet);
            console.log("Extracted Tweet ID:", tweetId);
            console.log("Extracted Tweet ID Type:", typeof tweetId);
            if (!tweetId) return null;

            // Enhanced image extraction with retry mechanism
            const images = this.extractImages(tweet);
            
            // Basic tweet data extraction
            const userNameElement = tweet.querySelector('a[href^="/"] span');
            const usernameElement = tweet.querySelector('a[href^="/"][role="link"] > div > span');
            const verifiedIcon = tweet.querySelector('[data-testid="icon-verified"]');
            const textElement = tweet.querySelector('[data-testid="tweetText"]');
            const timestampElement = tweet.querySelector('time');
            const timestamp = timestampElement ? timestampElement.getAttribute('datetime') : null;
            const created_at = timestamp ? new Date(timestamp).toISOString() : null;
    
            
            
            // Enhanced metrics extraction with validation
            const metrics = this.extractMetrics(tweet);
            
            return {
                tweetId: String(tweetId), 
                created_at: created_at,
                name: userNameElement?.innerText || 'Unknown User',
                username: usernameElement?.textContent || '@unknown',
                verified_user: verifiedIcon ? "yes" : "no",
                text: textElement ? textElement.innerText.trim() : '',
                ...metrics,
                images: images.imageUrls,
                hasImages: images.hasImages,
                video: this.extractVideos(tweet)
            };
        } catch (error) {
            console.error('Error extracting tweet data:', error);
            return null;
        }
    }

    extractImages(tweet) {
        try {
            const imageElements = tweet.querySelectorAll('[data-testid="tweetPhoto"] img');
            const imageUrls = [];
            let hasImages = false;

            imageElements.forEach(img => {
                if (img && img.src && !img.src.includes('emoji')) {
                    hasImages = true;
                    // Extract highest quality image URL
                    const originalUrl = img.src.replace(/&name=.+$/, '&name=orig');
                    imageUrls.push(originalUrl);
                }
            });

            return { imageUrls, hasImages };
        } catch (error) {
            console.error('Error extracting images:', error);
            return { imageUrls: [], hasImages: false };
        }
    }

    extractVideos(tweet) {
        try {
            return Array.from(tweet.querySelectorAll('video source'))
                .map(source => source.src)
                .filter(src => src && src.trim().length > 0);
        } catch (error) {
            console.error('Error extracting videos:', error);
            return [];
        }
    }

    extractMetrics(tweet) {
        try {
            const metrics = {
                comments: '0',
                retweets: '0',
                likes: '0',
                views: '0'
            };

            // Extract engagement metrics
            const replyElement = tweet.querySelector('[data-testid="reply"]');
            const retweetElement = tweet.querySelector('[data-testid="retweet"]');
            const likeElement = tweet.querySelector('[data-testid="like"]');
            const viewsElement = tweet.querySelector('a[href*="/analytics"]');

            if (replyElement) metrics.comments = this.parseEngagementNumber(replyElement.innerText);
            if (retweetElement) metrics.retweets = this.parseEngagementNumber(retweetElement.innerText);
            if (likeElement) metrics.likes = this.parseEngagementNumber(likeElement.innerText);
            if (viewsElement) {
                const viewsText = viewsElement.getAttribute('aria-label');
                metrics.views = this.parseEngagementNumber(viewsText?.replace(/\.? View post analytics/, '') || '0');
            }

            return metrics;
        } catch (error) {
            console.error('Error extracting metrics:', error);
            return {
                comments: '0',
                retweets: '0',
                likes: '0',
                views: '0'
            };
        }
    }

    parseEngagementNumber(text) {
        if (!text) return '0';
        try {
            const cleanText = text.replace(/[^0-9.KMB]/g, '');
            
            if (cleanText.includes('K')) {
                return (parseFloat(cleanText) * 1000).toString();
            }
            if (cleanText.includes('M')) {
                return (parseFloat(cleanText) * 1000000).toString();
            }
            if (cleanText.includes('B')) {
                return (parseFloat(cleanText) * 1000000000).toString();
            }
            
            return cleanText || '0';
        } catch (error) {
            console.error('Error parsing engagement number:', error);
            return '0';
        }
    }

    createTweetHash(tweetData) {
        return tweetData?.tweetId || null;
    }

    setupObserver() {
        const observerCallback = (mutations) => {
            if (!this.isRunning) return;

            const hasRelevantChanges = mutations.some(mutation => 
                Array.from(mutation.addedNodes).some(node => 
                    node.nodeType === 1 && 
                    (node.matches('article') || node.querySelector('article'))
                )
            );

            if (hasRelevantChanges) {
                clearTimeout(this.observerTimeout);
                this.observerTimeout = setTimeout(() => {
                    this.scrapeTweets();
                }, 200);
            }
        };

        this.observer = new MutationObserver(observerCallback);
        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    startPeriodicSend() {
        this.sendInterval = setInterval(async () => {
            if (this.scrapedData.size > 0 && 
                Date.now() - this.rateLimiter.lastSend >= this.rateLimiter.minInterval) {
                await this.sendDataToAPI();
            }
        }, 1000);
    }

    async sendDataToAPI() {
        if (this.isSending || !this.isRunning) return;
        this.isSending = true;

        const tweetsToSend = Array.from(this.scrapedData.values());
        if (tweetsToSend.length === 0) {
            this.isSending = false;
            return;
        }

        try {
            // Transform tweets to match user_tweets.py structure
            const transformedData = this.transformTweetsForAPI(tweetsToSend);
           
            console.log("Sending data:", JSON.stringify(transformedData, null, 2));


            let retries = this.retryCount;
            while (retries > 0) {
                try {
                    const response = await fetch(this.API_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(transformedData)
                    });
                    console.log("Response status:", response.status);
                    const responseBody = await response.text();
                    console.log("Response body:", responseBody);

                    if (response.ok) {
                        console.log(`Successfully sent ${tweetsToSend.length} tweets to API`);
                        tweetsToSend.forEach(tweet => {
                            const tweetHash = this.createTweetHash(tweet);
                            if (tweetHash) {
                                this.scrapedData.delete(tweetHash);
                                this.sentTweetHashes.add(tweetHash);
                                this.pendingTweets.delete(tweetHash);
                            }
                        });
                        this.rateLimiter.lastSend = Date.now();
                        break;
                    } else {
                        throw new Error(`API responded with status: ${response.status}, body: ${responseBody}`);
                    }
                } catch (error) {
                    console.error('Detailed API send error:', error);
                    retries--;
                    if (retries === 0) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            console.error('Error sending data to API:', error);
            tweetsToSend.forEach(tweet => {
                const tweetHash = this.createTweetHash(tweet);
                if (tweetHash) {
                    this.pendingTweets.delete(tweetHash);
                }
            });
        } finally {
            this.isSending = false;
        }
    }
    transformTweetsForAPI(tweets) {
        console.log("Raw tweets input:", tweets);
        const userTweetsMap = new Map();
    
        tweets.forEach(tweet => {
            console.log("Processing individual tweet:", tweet);
            
            // Explicitly convert to string and ensure exact representation
            const originalTweetId = tweet.tweetId.toString();
            
            if (!userTweetsMap.has(tweet.username)) {
                const userEntry = {
                    username: tweet.username,
                    screen_name: tweet.name || tweet.username,
                    is_blue_verified: tweet.verified_user || "no",
                    user_id: null,
                    profile_image_url: null,
                    profile_banner_url: null,
                    users_url: null,
                    bio: null,
                    description: null,
                    location: null,
                    following_count: null,
                    followers_count: null,
                    tweets_count: null,
                    joined: null,
                    tweets: []
                };
                userTweetsMap.set(tweet.username, userEntry);
            }
    
            const transformedTweet = {
                tweet_id: originalTweetId, // Use the string version of tweet ID
                user_id: null,
                content: tweet.text || "",
                created_at: tweet.created_at || new Date().toISOString(),
                retweet_count: parseInt(tweet.retweets || 0),
                like_count: parseInt(tweet.likes || 0),
                reply_count: parseInt(tweet.comments || 0),
                quote_count: 0,
                view_count: parseInt(tweet.views || 0),
                location: null,
                lang: null
            };
    
            // Add media URL (combining images and videos)
            const mediaUrls = [...(tweet.images || []), ...(tweet.video || [])];
            if (mediaUrls.length > 0) {
                transformedTweet.media_url = mediaUrls[0];  // Take first media URL
            }
    
            // Debugging logs
            console.log("Original Tweet ID:", tweet.tweetId);
            console.log("Transformed Tweet ID:", transformedTweet.tweet_id);
            console.log("Tweet ID Types - Original:", typeof tweet.tweetId, "Transformed:", typeof transformedTweet.tweet_id);
    
            userTweetsMap.get(tweet.username).tweets.push(transformedTweet);
        });
    
        // Convert Map to array for API request
        const result = {
            users_tweets: Array.from(userTweetsMap.values())
        };
    
        return result;
    }
}

// Initialize and start the scraper
const scraper = new TweetScraper();
scraper.start();