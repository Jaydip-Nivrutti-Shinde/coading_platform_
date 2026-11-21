const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { startFixture } = require('./support/fixture');

async function main() {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const fixture = await startFixture();
    const uploadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-browser-'));
    let vite;
    let browser;
    try {
        const frontend = path.resolve(__dirname, '../../frontend');
        process.env.VITE_API_URL = '/api';
        const { createServer } = await import(pathToFileURL(path.join(frontend, 'node_modules/vite/dist/node/index.js')));
        vite = await createServer({ root: frontend, configFile: path.join(frontend, 'vite.config.js'),
            server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: fixture.baseURL, rewrite: url => url.replace(/^\/api/, '') } } } });
        await vite.listen();
        const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
        browser = await chromium.launch({ headless: true,
            ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
        const context = await browser.newContext();
        await context.addCookies([{ name: 'token', value: fixture.adminToken, url: origin }]);
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/admin/update');
        await page.getByText('No problems found.').waitFor();
        await page.reload();
        await page.getByRole('heading', { name: 'Update Problems', exact: true }).waitFor();
        console.log('PASS: empty problem list and direct admin route reload');

        await page.goto(origin + '/admin/create');
        await page.getByRole('button', { name: 'Create Problem', exact: false }).click();
        await page.getByRole('alert').filter({ hasText: 'Please complete' }).waitFor();
        for (const [name, value] of Object.entries({ title: 'Browser Echo', description: 'Echo the input.',
            'visibleTestCases.0.input': 'visible', 'visibleTestCases.0.output': 'visible',
            'visibleTestCases.0.explanation': 'Echo the visible input.', 'hiddenTestCases.0.input': 'hidden', 'hiddenTestCases.0.output': 'hidden' })) {
            await page.locator(`[name="${name}"]`).fill(value);
        }
        for (let index = 0; index < 3; index++) {
            await page.locator(`[name="startCode.${index}.initialCode"]`).fill('// Starter');
            await page.locator(`[name="referenceSolution.${index}.completeCode"]`).fill('// Accepted test reference');
        }
        await page.getByRole('button', { name: 'Create Problem', exact: false }).click();
        await page.waitForURL('**/admin/update');
        await page.getByText('Problem created successfully', { exact: true }).waitFor();
        await page.getByRole('link', { name: 'Edit', exact: true }).click();
        await page.locator('[name="title"]').waitFor();
        assert.equal(await page.locator('[name="hiddenTestCases.0.input"]').inputValue(), 'hidden');
        await page.locator('[name="title"]').fill('Updated Browser Echo');
        await page.locator('[name="difficulty"]').selectOption('hard');
        await page.getByRole('button', { name: 'Update Problem', exact: false }).click();
        await page.waitForURL('**/admin/update');
        await page.getByText('Problem updated successfully', { exact: true }).waitFor();
        await page.getByRole('cell', { name: 'Updated Browser Echo', exact: true }).waitFor();
        const Problem = require('../src/models/problem');
        const problem = await Problem.findOne({ title: 'Updated Browser Echo' });
        assert.equal(problem.difficulty, 'hard');
        console.log('PASS: frontend validation, create, prefilled edit, update and persisted MongoDB values');

        let uploadCalls = 0;
        let transientFailed = false;
        const ranges = [];
        const uploadIds = new Set();
        await page.route('https://api.cloudinary.com/**', async route => {
            const req = route.request();
            const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
            if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
            uploadCalls++;
            const range = req.headers()['content-range'];
            ranges.push(range);
            uploadIds.add(req.headers()['x-unique-upload-id']);
            if (!transientFailed) { transientFailed = true; return route.fulfill({ status: 503, headers: cors, json: { error: { message: 'Temporary upload failure' } } }); }
            const publicId = req.postDataBuffer().toString('latin1').match(/name="public_id"\r\n\r\n([^\r\n]+)/)?.[1];
            assert.ok(publicId);
            const [, , end, total] = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
            const done = Number(end) + 1 === Number(total);
            return route.fulfill({ headers: cors, json: done ? { public_id: publicId, secure_url: 'https://example.test/editorial.webm', duration: 1, done: true } : { done: false } });
        });
        await page.goto(origin + `/admin/upload/${problem._id}`);
        const uploadPath = path.join(uploadDirectory, 'Recording.mp4');
        await fs.writeFile(uploadPath, Buffer.alloc(Math.ceil(30.11 * 1024 * 1024), 1));
        await page.locator('input[type="file"]').setInputFiles(uploadPath, { timeout: 60000 });
        fixture.state.durationPending = true;
        await page.getByRole('button', { name: 'Upload Video', exact: true }).click();
        try {
            await page.getByRole('alert').filter({ hasText: 'Cloudinary has not returned its duration yet' }).waitFor({ timeout: 60000 });
        } catch (error) {
            console.error('Upload diagnostic:', { uploadCalls, ranges, body: (await page.locator('body').innerText()).slice(-2000) });
            throw error;
        }
        const completedCalls = uploadCalls;
        assert.equal(completedCalls, 7); // six chunks plus one retry
        assert.equal(ranges[0], ranges[1]);
        assert.equal(uploadIds.size, 1);
        await page.reload();
        await page.getByRole('button', { name: 'Retry Saving Video', exact: true }).waitFor();
        fixture.state.durationPending = false;
        await page.getByRole('button', { name: 'Retry Saving Video', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Upload Successful!' }).waitFor();
        assert.equal(uploadCalls, completedCalls);
        console.log('PASS: 30.11 MB chunked upload, failed-chunk retry, missing metadata error and metadata-only retry');

        await page.goto(origin + '/admin/video');
        await page.getByRole('button', { name: 'Delete Video', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Delete Video', exact: true }).isEnabled(), true);
        await page.goto(origin + `/problem/${problem._id}`);
        await page.getByRole('button', { name: 'Editorial', exact: true }).click();
        assert.equal(await page.locator('video').getAttribute('src'), 'https://example.test/editorial.webm');
        console.log('PASS: editorial receives saved video URL');
        await page.goto(origin + '/admin/video');
        page.on('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Delete Video', exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Delete Video' && button.disabled));
        await page.getByRole('cell', { name: 'Updated Browser Echo', exact: true }).waitFor();
        assert.equal(await require('../src/models/solutionVideo').countDocuments(), 0);
        console.log('PASS: deleting a video preserves the problem row and clears its metadata');
        await page.goto(origin + '/admin/delete');
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.getByText('No problems found. Create some!').waitFor();
        assert.equal(await Problem.countDocuments(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS: problem deletion and no frontend runtime exceptions');
    } finally {
        if (browser) await browser.close();
        if (vite) await vite.close();
        await fixture.close();
        await fs.rm(uploadDirectory, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
