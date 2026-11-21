const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

async function freePort() {
    const listener = net.createServer();
    await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    return port;
}

// Real HTTP routes, JWT authentication and isolated MongoDB. Only Redis's blocklist,
// Judge0 and Cloudinary are replaced, so tests never modify cloud services or user data.
async function startFixture() {
    process.env.JWT_KEY = 'local-integration-test-key';
    process.env.JUDGE0_KEY = 'local-judge-test-key';
    process.env.CLOUDINARY_CLOUD_NAME = 'integration-test';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'code-platform-test-'));
    const port = await freePort();
    const mongo = spawn('mongod', ['--dbpath', directory, '--port', String(port), '--bind_ip', '127.0.0.1', '--nounixsocket', '--quiet']);
    let output = '';
    mongo.stdout.on('data', data => { output += data; });
    mongo.stderr.on('data', data => { output += data; });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Test MongoDB did not start: ${output.slice(-1500)}`)), 20000);
        mongo.once('error', error => { clearTimeout(timeout); reject(error); });
        mongo.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test MongoDB exited (${code}): ${output.slice(-1500)}`)); });
        mongo.stdout.on('data', () => {
            if (output.includes('Waiting for connections')) { clearTimeout(timeout); resolve(); }
        });
    });
    await mongoose.connect(`mongodb://127.0.0.1:${port}/problem_flow_test`);
    const redis = require('../../src/config/redis');
    const originalExists = redis.exists;
    redis.exists = async () => 0;
    const axios = require('axios');
    const originalRequest = axios.request;
    const submissions = new Map();
    let batchCalls = 0;
    axios.request = async options => {
        if (!options.url.startsWith('https://judge0-ce.p.rapidapi.com/')) return originalRequest(options);
        if (options.method === 'POST') {
            batchCalls++;
            return { data: options.data.submissions.map((submission, index) => {
                const token = `${batchCalls}-${index}`;
                submissions.set(token, submission);
                return { token };
            }) };
        }
        return { data: { submissions: options.params.tokens.split(',').map(token => {
            const submission = submissions.get(token);
            const failed = submission.source_code.includes('FAIL_ALL') ||
                (submission.source_code.includes('FAIL_HIDDEN') && submission.stdin === 'hidden');
            return { status_id: failed ? 4 : 3, status: { description: failed ? 'Wrong Answer' : 'Accepted' } };
        }) } };
    };
    const cloudinary = require('cloudinary').v2;
    const originalResource = cloudinary.api.resource;
    const originalDestroy = cloudinary.uploader.destroy;
    const state = { cloudDown: false, durationPending: false, saveFailures: 0, destroys: [], submissions, get batchCalls() { return batchCalls; } };
    cloudinary.api.resource = async (publicId, options) => {
        if (state.saveFailures > 0) { state.saveFailures--; throw new Error('Cloudinary temporarily unavailable'); }
        return { public_id: publicId, resource_type: 'video', ...(options?.media_metadata && !state.durationPending ? { duration: 1 } : {}),
            secure_url: 'https://example.test/editorial.webm' };
    };
    cloudinary.uploader.destroy = async publicId => {
        if (state.cloudDown) throw new Error('Cloudinary temporarily unavailable');
        state.destroys.push(publicId);
        return { result: 'ok' };
    };
    const User = require('../../src/models/user');
    const password = await bcrypt.hash('Integration123!', 4);
    // Distinct values accommodate the legacy unique index on problemSolved.
    // These IDs do not reference real problems and populate to an empty list.
    const admin = await User.create({ firstName: 'Test Admin', email: 'admin@test.local', password, role: 'admin', problemSolved: [new mongoose.Types.ObjectId()] });
    const user = await User.create({ firstName: 'Test User', email: 'user@test.local', password, role: 'user', problemSolved: [new mongoose.Types.ObjectId()] });
    const token = account => jwt.sign({ _id: account._id, role: account.role }, process.env.JWT_KEY, { expiresIn: '1h' });
    const { app, server } = require('../../src/index');
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    return { app, server, baseURL, state, admin, user, adminToken: token(admin), userToken: token(user),
        async close() {
            await new Promise(resolve => server.close(resolve));
            server.closeAllConnections();
            redis.exists = originalExists;
            axios.request = originalRequest;
            cloudinary.api.resource = originalResource;
            cloudinary.uploader.destroy = originalDestroy;
            await mongoose.disconnect();
            await new Promise(resolve => { mongo.once('exit', resolve); mongo.kill('SIGTERM'); });
            await fs.rm(directory, { recursive: true, force: true });
        }
    };
}

function problemPayload(overrides = {}) {
    return { title: 'Echo input', description: 'Read input and print it.', difficulty: 'easy', tags: 'array',
        visibleTestCases: [{ input: 'visible', output: 'visible', explanation: 'Echo the input.' }],
        hiddenTestCases: [{ input: 'hidden', output: 'hidden' }],
        startCode: ['C++', 'Java', 'JavaScript'].map(language => ({ language, initialCode: '// Starter' })),
        referenceSolution: ['C++', 'Java', 'JavaScript'].map(language => ({ language, completeCode: '// Reference test fixture' })),
        ...overrides };
}
module.exports = { startFixture, problemPayload };
