const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
const cloudinary = require('cloudinary').v2;
const Problem = require('../src/models/problem');
const SolutionVideo = require('../src/models/solutionVideo');
const { saveVideoMetadata } = require('../src/controllers/videoSection');

const problemId = '111111111111111111111111';
const userId = '222222222222222222222222';
const publicId = `leetcode-solutions/${problemId}/${userId}_uploaded-video`;
const resource = { public_id: publicId, resource_type: 'video', secure_url: 'https://res.cloudinary.com/test-cloud/video/upload/recording.mp4' };

function setup(t, overrides = {}) {
    const saved = [];
    t.mock.method(Problem, 'findById', async () => ({ _id: problemId }));
    t.mock.method(SolutionVideo, 'findOne', async () => null);
    t.mock.method(SolutionVideo, 'create', async data => {
        const document = new SolutionVideo(data);
        await document.validate();
        saved.push(data);
        return document;
    });
    t.mock.method(cloudinary.api, 'resource', async (_id, options) => ({ ...resource,
        ...(options.media_metadata ? { duration: 123.45 } : {}), ...overrides }));
    const req = { user: { _id: userId }, body: { problemId, cloudinaryPublicId: publicId,
        duration: 999, secureUrl: 'https://untrusted.example/fake.mp4' } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; } };
    return { req, res, saved };
}

test('requests detailed Cloudinary media metadata before validating and saving duration', async t => {
    const { req, res, saved } = setup(t);
    await saveVideoMetadata(req, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(cloudinary.api.resource.mock.calls[0].arguments, [publicId, { resource_type: 'video', media_metadata: true }]);
    assert.equal(saved[0].duration, 123.45);
    assert.equal(saved[0].secureUrl, resource.secure_url);
    assert.match(saved[0].thumbnailUrl, /^https:\/\//);
    assert.equal(res.body.videoSolution.duration, 123.45);
});

test('missing duration is retryable and does not discard or save the uploaded video', async t => {
    const { req, res, saved } = setup(t, { duration: undefined });
    await saveVideoMetadata(req, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.message, /retry saving/);
    assert.equal(saved.length, 0);
    cloudinary.api.resource.mock.mockImplementation(async () => ({ ...resource, duration: 32 }));
    await saveVideoMetadata(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(saved[0].duration, 32);
});

for (const [name, overrides] of [
    ['non-video asset', { resource_type: 'image' }],
    ['different public ID', { public_id: 'someone-elses-video' }],
    ['insecure URL', { secure_url: 'http://untrusted.example/video.mp4' }]
]) {
    test(`rejects ${name}`, async t => {
        const { req, res, saved } = setup(t, overrides);
        await saveVideoMetadata(req, res);
        assert.equal(res.statusCode, 400);
        assert.equal(saved.length, 0);
    });
}

for (const duration of [null, '123', NaN, Infinity, -1]) {
    test(`does not save invalid duration: ${duration}`, async t => {
        const { req, res, saved } = setup(t, { duration });
        await saveVideoMetadata(req, res);
        assert.equal(res.statusCode, 503);
        assert.equal(saved.length, 0);
    });
}

test('metadata save retry returns the existing video without a duplicate', async t => {
    const { req, res, saved } = setup(t);
    t.mock.method(SolutionVideo, 'findOne', async () => ({ cloudinaryPublicId: publicId, duration: 123.45 }));
    await saveVideoMetadata(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.length, 0);
    assert.equal(cloudinary.api.resource.mock.callCount(), 0);
});
