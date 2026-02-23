async function testFetchTimeout() {
    const controller = new AbortController();
    const timeoutMs = 300000;
    const timeout = setTimeout(() => {
        console.log("Abort signal triggered!");
        controller.abort();
    }, timeoutMs);

    console.log(`Starting fetch with ${timeoutMs}ms timeout...`);
    const start = Date.now();
    try {
        // Use a URL that we know will hang or take time.
        // httpstat.us can simulate delay
        const response = await fetch("https://postman-echo.com/delay/10", {
            signal: controller.signal
        });
        console.log(`Fetch succeeded after ${Date.now() - start}ms: ${response.status}`);
    } catch (err) {
        console.log(`Fetch failed after ${Date.now() - start}ms: ${err.name} - ${err.message}`);
    } finally {
        clearTimeout(timeout);
    }
}

testFetchTimeout();
