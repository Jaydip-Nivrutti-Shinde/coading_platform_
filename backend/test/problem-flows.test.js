const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { startFixture, problemPayload } = require('./support/fixture');
const Problem = require('../src/models/problem');
const SolutionVideo = require('../src/models/solutionVideo');
let fixture;
before(async () => { fixture = await startFixture(); });
after(async () => { if (fixture) await fixture.close(); });
async function request(method, path, body, token = fixture.adminToken) {
    const response = await fetch(fixture.baseURL + path, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `token=${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
}
async function create(overrides) {
    const response = await request('POST', '/problem/create', problemPayload(overrides));
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.problem;
}

test('empty lists return 200; authenticated routes and admin role are enforced', async () => {
    assert.deepEqual(await request('GET', '/problem/getAllProblem'), { status: 200, data: [] });
    assert.equal((await request('GET', '/problem/getAllProblem', undefined, '')).status, 401);
    assert.equal((await request('POST', '/problem/create', problemPayload(), fixture.userToken)).status, 403);
    assert.deepEqual((await request('GET', '/problem/problemSolvedByUser')).data, []);
});

test('create validates the payload before calling Judge0 and verifies hidden tests', async () => {
    const before = fixture.state.batchCalls;
    for (const overrides of [{ title: ' ' }, { difficulty: 'Easy' }, { tags: 'invalid' },
        { visibleTestCases: [] }, { hiddenTestCases: [] }, { referenceSolution: null },
        { startCode: [{ language: 'Python', initialCode: 'pass' }] },
        { startCode: [{ language: 'C++', initialCode: 'code' }] },
        { visibleTestCases: [{ input: 'test', output: 'test' }] }]) {
        assert.equal((await request('POST', '/problem/create', problemPayload(overrides))).status, 400);
    }
    assert.equal(fixture.state.batchCalls, before);
    const payload = problemPayload();
    payload.referenceSolution[0].completeCode = 'FAIL_HIDDEN';
    const failed = await request('POST', '/problem/create', payload);
    assert.equal(failed.status, 400);
    assert.equal(failed.data.result.language, 'C++');
    assert.equal(failed.data.result.testCaseType, 'hidden');
    assert.equal(await Problem.countDocuments(), 0);
    const key = process.env.JUDGE0_KEY;
    delete process.env.JUDGE0_KEY;
    assert.equal((await request('POST', '/problem/create', problemPayload())).status, 503);
    process.env.JUDGE0_KEY = key;
});

test('create, list, edit, partial update and public detail preserve their API contracts', async () => {
    const problem = await create({ problemCreator: fixture.user._id });
    assert.equal(String(problem.problemCreator), String(fixture.admin._id));
    const list = await request('GET', '/problem/getAllProblem');
    assert.equal(list.data[0].hasVideo, false);
    assert.equal(list.data[0].hiddenTestCases, undefined);
    const details = await request('GET', `/problem/problemById/${problem._id}`, undefined, fixture.userToken);
    assert.equal(details.status, 200);
    assert.equal(details.data.hiddenTestCases, undefined);
    assert.equal(details.data.secureUrl, undefined);
    const edit = await request('GET', `/problem/edit/${problem._id}`);
    assert.equal(edit.data.hiddenTestCases[0].input, 'hidden');
    assert.equal((await request('GET', `/problem/edit/${problem._id}`, undefined, fixture.userToken)).status, 403);
    const update = await request('PUT', `/problem/update/${problem._id}`, {
        title: 'Updated echo', difficulty: 'hard', problemCreator: fixture.user._id, unexpected: 'ignored'
    });
    assert.equal(update.status, 200);
    assert.equal(update.data.title, 'Updated echo');
    assert.equal(update.data.difficulty, 'hard');
    assert.equal(String(update.data.problemCreator), String(fixture.admin._id));
    assert.equal(update.data.unexpected, undefined);
    assert.equal(update.data.hiddenTestCases.length, 1);
    const payload = problemPayload(); payload.referenceSolution[1].completeCode = 'FAIL_ALL';
    assert.equal((await request('PUT', `/problem/update/${problem._id}`, payload)).status, 400);
    assert.equal((await Problem.findById(problem._id)).title, 'Updated echo');
    assert.deepEqual((await request('GET', `/problem/submittedProblem/${problem._id}`)).data, []);
});

test('malformed and missing IDs return 400 and 404 on problem and video routes', async () => {
    for (const id of ['bad-id', '111111111111111111111111']) {
        const expected = id === 'bad-id' ? 400 : 404;
        for (const route of ['/problem/problemById/', '/problem/edit/', '/video/create/']) {
            assert.equal((await request('GET', route + id)).status, expected);
        }
        assert.equal((await request('PUT', '/problem/update/' + id, {})).status, expected);
        assert.equal((await request('DELETE', '/problem/delete/' + id)).status, expected);
    }
});

test('video signature, trusted metadata, retry, editorial retrieval and deletion', async () => {
    const problem = await create({ title: 'Video problem' });
    const credentials = await request('GET', `/video/create/${problem._id}`);
    assert.equal(credentials.status, 200);
    assert.equal(credentials.data.api_secret, undefined);
    assert.match(credentials.data.public_id, new RegExp(`^leetcode-solutions/${problem._id}/${fixture.admin._id}_`));
    assert.equal((await request('GET', `/video/create/${problem._id}`, undefined, fixture.userToken)).status, 403);
    assert.equal((await request('POST', '/video/save', { problemId: problem._id, cloudinaryPublicId: 'unrelated/video' })).status, 400);
    const payload = { problemId: problem._id, cloudinaryPublicId: credentials.data.public_id,
        secureUrl: 'https://untrusted.test/fake.mp4', duration: 99999 };
    fixture.state.saveFailures = 1;
    assert.equal((await request('POST', '/video/save', payload)).status, 502);
    assert.equal(await SolutionVideo.countDocuments({ problemId: problem._id }), 0);
    const saved = await request('POST', '/video/save', payload);
    assert.equal(saved.status, 201);
    assert.equal(saved.data.videoSolution.secureUrl, 'https://example.test/editorial.webm');
    assert.equal(saved.data.videoSolution.duration, 1);
    assert.match(saved.data.videoSolution.thumbnailUrl, /^https:\/\//);
    assert.ok(!saved.data.videoSolution.thumbnailUrl.includes('<img'));
    assert.equal((await request('POST', '/video/save', payload)).status, 200);
    assert.equal(await SolutionVideo.countDocuments({ problemId: problem._id }), 1);
    assert.equal((await request('GET', `/video/create/${problem._id}`)).status, 409);
    assert.equal((await request('GET', '/problem/getAllProblem')).data.find(item => item._id === problem._id).hasVideo, true);
    assert.equal((await request('GET', `/problem/problemById/${problem._id}`)).data.secureUrl, 'https://example.test/editorial.webm');
    fixture.state.cloudDown = true;
    assert.equal((await request('DELETE', `/video/delete/${problem._id}`)).status, 502);
    assert.equal(await SolutionVideo.countDocuments({ problemId: problem._id }), 1);
    fixture.state.cloudDown = false;
    assert.equal((await request('DELETE', `/video/delete/${problem._id}`)).status, 200);
    assert.equal(await SolutionVideo.countDocuments({ problemId: problem._id }), 0);
    assert.equal((await request('DELETE', `/video/delete/${problem._id}`)).status, 404);
    assert.ok(await Problem.findById(problem._id));
    assert.equal((await request('GET', `/problem/problemById/${problem._id}`)).data.secureUrl, undefined);
});

test('deleting a problem removes associated video metadata and submissions', async () => {
    const problem = await create({ title: 'Delete this problem' });
    const credentials = await request('GET', `/video/create/${problem._id}`);
    await request('POST', '/video/save', { problemId: problem._id, cloudinaryPublicId: credentials.data.public_id });
    assert.equal((await request('DELETE', `/problem/delete/${problem._id}`)).status, 200);
    assert.equal(await Problem.findById(problem._id), null);
    assert.equal(await SolutionVideo.countDocuments({ problemId: problem._id }), 0);
});
