const mongoose = require('mongoose');
const Problem = require('../models/problem');
const User = require('../models/user');
const Submission = require('../models/submissions');
const SolutionVideo = require('../models/solutionVideo');
const { validateProblem, verifyReferenceSolutions } = require('../utils/problemValidation');

const fail = (res, error) => res.status(error.status || (error.name === 'ValidationError' ? 400 : 500)).json({
    success: false,
    message: error.message || 'Unable to save problem',
    ...(error.result ? { result: error.result } : {})
});
const validId = (id, res) => {
    if (mongoose.isObjectIdOrHexString(id)) return true;
    res.status(400).json({ message: 'Invalid problem ID' });
    return false;
};

const createProblem = async (req, res) => {
    try {
        const payload = await validateProblem(req.body, req.user._id);
        await verifyReferenceSolutions(payload);
        const problem = await Problem.create(payload);
        return res.status(201).json({ success: true, message: 'Problem created successfully', problem });
    } catch (error) {
        return fail(res, error);
    }
};

const updateProblem = async (req, res) => {
    if (!validId(req.params.id, res)) return;
    try {
        const existing = await Problem.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: 'Problem not found' });
        // Only editable fields are accepted; the original creator is preserved.
        const payload = await validateProblem({ ...existing.toObject(), ...req.body }, existing.problemCreator);
        await verifyReferenceSolutions(payload);
        const problem = await Problem.findByIdAndUpdate(existing._id, { $set: payload }, { runValidators: true, returnDocument: 'after' });
        return res.status(200).json(problem);
    } catch (error) {
        return fail(res, error);
    }
};

const deleteProblem = async (req, res) => {
    if (!validId(req.params.id, res)) return;
    try {
        const problem = await Problem.findById(req.params.id);
        if (!problem) return res.status(404).json({ message: 'Problem not found' });
        const { removeProblemVideos } = require('./videoSection');
        await removeProblemVideos(problem._id);
        await Problem.findByIdAndDelete(problem._id);
        await Submission.deleteMany({ problemId: problem._id });
        await User.updateMany({ problemSolved: problem._id }, { $pull: { problemSolved: problem._id } });
        return res.status(200).json({ message: 'Problem deleted successfully' });
    } catch (error) {
        return fail(res, error);
    }
};

const getProblemForEdit = async (req, res) => {
    if (!validId(req.params.id, res)) return;
    try {
        const problem = await Problem.findById(req.params.id);
        if (!problem) return res.status(404).json({ message: 'Problem not found' });
        return res.json(problem);
    } catch (error) {
        return fail(res, error);
    }
};

const getProblemById = async (req, res) => {
    if (!validId(req.params.id, res)) return;
    try {
        const problem = await Problem.findById(req.params.id)
            .select('_id title description difficulty tags visibleTestCases startCode referenceSolution').lean();
        if (!problem) return res.status(404).json({ message: 'Problem not found' });
        const video = await SolutionVideo.findOne({ problemId: problem._id }).sort({ createdAt: -1 });
        return res.json({ ...problem, ...(video ? {
            secureUrl: video.secureUrl, thumbnailUrl: video.thumbnailUrl, duration: video.duration
        } : {}) });
    } catch (error) {
        return fail(res, error);
    }
};

const getAllProblem = async (req, res) => {
    try {
        const problems = await Problem.find({}).select('_id title difficulty tags').lean();
        const videos = await SolutionVideo.find({ problemId: { $in: problems.map(problem => problem._id) } })
            .select('problemId');
        const videoIds = new Set(videos.map(video => String(video.problemId)));
        return res.json(problems.map(problem => ({ ...problem, hasVideo: videoIds.has(String(problem._id)) })));
    } catch (error) {
        return fail(res, error);
    }
};

const solvedAllProblembyUser =  async(req,res)=>{
    
        try{
        
        const userId = req.user._id;

        const user =  await User.findById(userId).populate({
            path:"problemSolved",
            select:"_id title difficulty tags"
        });
        
        res.status(200).json(user?.problemSolved || []);

        }
        catch(err){
        res.status(500).send("Server Error");
        }
    }

const submittedProblem = async(req,res)=>{

  try{
   
     
    const userId = req.user._id;
    
    const problemId = req.params.pid;
   const ans = await Submission.find({userId,problemId});


  return res.status(200).json(ans);

  }
  catch(err){
     res.status(500).send("Internal Server Error");
  }
}

module.exports = {
    createProblem,
    updateProblem,
    deleteProblem,
    getAllProblem,
    getProblemById,
    getProblemForEdit,
    solvedAllProblembyUser,
    submittedProblem
};


