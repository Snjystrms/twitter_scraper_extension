document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('start-scraping');
    const stopButton = document.getElementById('stop-scraping');
    const statusDiv = document.getElementById('status');

    function updateStatus(message, isError = false) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${isError ? 'error' : 'success'}`;
    }

    startButton.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('twitter.com') && !tab.url.includes('x.com')) {
                throw new Error('Please navigate to Twitter/X to use this extension');
            }

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const event = new CustomEvent('startScraping');
                    document.dispatchEvent(event);
                }
            });

            updateStatus('Scraping started successfully!');
        } catch (error) {
            updateStatus(error.message, true);
        }
    });

    stopButton.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const event = new CustomEvent('stopScraping');
                    document.dispatchEvent(event);
                }
            });

            updateStatus('Scraping stopped');
        } catch (error) {
            updateStatus(error.message, true);
        }
    });
});