chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
});

// Handle browser action clicks
chrome.action.onClicked.addListener((tab) => {
    if (tab.url.includes('twitter.com') || tab.url.includes('x.com')) {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        }).then(() => {
            console.log('Content script injected successfully');
        }).catch(err => {
            console.error('Failed to inject script:', err);
        });
    } else {
        console.log('Not a Twitter/X page');
    }
});

// Optional: Add message passing for more complex interactions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startScraping') {
        // You can add more complex logic here if needed
        console.log('Scraping started from background script');
    }
});