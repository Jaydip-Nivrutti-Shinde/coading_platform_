const Problem = require('../models/problem');
const { getLanguageById, submitBatch, submitToken } = require('./problemUtility');

const editableFields = ['title', 'description', 'difficulty', 'tags', 'visibleTestCases',
    'hiddenTestCases', 'startCode', 'referenceSolution'];
const invalid = message => Object.assign(new Error(message), { status: 400 });

async function validateProblem(body, creator) {
    if (!body || typeof body !== 'object') throw invalid('Problem details are required');
    const payload = Object.fromEntries(editableFields.map(field => [field, body[field]]));
    payload.problemCreator = creator;
    for (const field of ['title', 'description']) {
        if (typeof payload[field] !== 'string' || !payload[field].trim()) throw invalid(`${field} is required`);
        payload[field] = payload[field].trim();
    }
    for (const field of ['visibleTestCases', 'hiddenTestCases', 'startCode', 'referenceSolution']) {
        if (!Array.isArray(payload[field]) || !payload[field].length) throw invalid(`${field} must be a non-empty array`);
    }
    for (const field of ['startCode', 'referenceSolution']) {
        const seen = new Set();
        for (const code of payload[field]) {
            const language = typeof code?.language === 'string' ? code.language.toLowerCase() : '';
            if (!getLanguageById(language)) throw invalid(`Unsupported language: ${code?.language || '(missing)'}`);
            if (seen.has(language)) throw invalid(`Duplicate language: ${code.language}`);
            seen.add(language);
            const source = field === 'startCode' ? code.initialCode : code.completeCode;
            if (typeof source !== 'string' || !source.trim()) throw invalid(`Code is required for ${code.language}`);
        }
    }
    const starters = payload.startCode.map(code => code.language.toLowerCase()).sort();
    const solutions = payload.referenceSolution.map(code => code.language.toLowerCase()).sort();
    if (JSON.stringify(starters) !== JSON.stringify(solutions)) throw invalid('Starter and reference solution languages must match');
    const document = new Problem(payload);
    await document.validate();
    // Mongoose strips unknown fields from nested objects as well.
    const validated = document.toObject();
    delete validated._id;
    return validated;
}

async function verifyReferenceSolutions(payload) {
    if (!process.env.JUDGE0_KEY) {
        throw Object.assign(new Error('Code validation is not configured. Set JUDGE0_KEY on the backend.'), { status: 503 });
    }
    const cases = [...payload.visibleTestCases, ...payload.hiddenTestCases];
    const submissions = payload.referenceSolution.flatMap(solution => cases.map(testCase => ({
        language_id: getLanguageById(solution.language), source_code: solution.completeCode,
        stdin: testCase.input, expected_output: testCase.output
    })));
    try {
        const submitted = await submitBatch(submissions);
        if (!Array.isArray(submitted) || submitted.length !== submissions.length || submitted.some(item => !item.token)) {
            throw new Error('Code validation service returned invalid submission tokens');
        }
        const results = await submitToken(submitted.map(item => item.token));
        if (!Array.isArray(results) || results.length !== submissions.length || results.some(item => !item?.status_id)) {
            throw new Error('Code validation service returned incomplete results');
        }
        const failed = results.findIndex(result => result.status_id !== 3);
        if (failed !== -1) {
            const result = results[failed];
            const solution = payload.referenceSolution[Math.floor(failed / cases.length)];
            throw Object.assign(invalid('Reference solution failed'), { result: {
                language: solution.language, input: submissions[failed].stdin,
                testCaseType: failed % cases.length < payload.visibleTestCases.length ? 'visible' : 'hidden',
                status: result.status, status_id: result.status_id,
                stderr: result.stderr, compile_output: result.compile_output, message: result.message
            } });
        }
    } catch (error) {
        if (error.status === 400) throw error;
        throw Object.assign(new Error(error.response ? 'Code validation service is unavailable. Check JUDGE0_KEY and your Judge0 quota.' : error.message), { status: 502 });
    }
}

module.exports = { validateProblem, verifyReferenceSolutions };
