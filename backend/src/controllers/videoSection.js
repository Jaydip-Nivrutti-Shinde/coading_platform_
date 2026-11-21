const cloudinary = require('cloudinary').v2;
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const Problem = require('../models/problem');
const SolutionVideo = require('../models/solutionVideo');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const configured = () => ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].every(key => process.env[key]);
const validId = (id, res) => {
    if (mongoose.isObjectIdOrHexString(id)) return true;
    res.status(400).json({ message: 'Invalid problem ID' });
    return false;
};
const cloudError = (res, error, fallback) => res.status(error.http_code === 404 ? 400 : 502)
    .json({ message: error.http_code === 404 ? 'Video not found on Cloudinary' : fallback });

const generateUploadSignature = async (req, res) => {
    if (!validId(req.params.problemId, res)) return;
    try {
        const { problemId } = req.params;
        if (!await Problem.findById(problemId)) return res.status(404).json({ message: 'Problem not found' });
        if (!configured()) return res.status(503).json({ message: 'Video uploads are not configured on the backend' });
        if (await SolutionVideo.exists({ problemId })) {
            return res.status(409).json({ message: 'Delete the existing video before uploading a replacement' });
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const publicId = `leetcode-solutions/${problemId}/${req.user._id}_${randomUUID()}`;
        const signature = cloudinary.utils.api_sign_request({ timestamp, public_id: publicId }, process.env.CLOUDINARY_API_SECRET);
        return res.json({ signature, timestamp, public_id: publicId,
            api_key: process.env.CLOUDINARY_API_KEY, cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            upload_url: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload`
        });
    } catch (error) {
        return cloudError(res, error, 'Failed to generate upload credentials');
    }
};

const saveVideoMetadata = async (req, res) => {
    const { problemId, cloudinaryPublicId } = req.body || {};
    if (!validId(problemId, res)) return;
    const prefix = `leetcode-solutions/${problemId}/${req.user._id}_`;
    if (typeof cloudinaryPublicId !== 'string' || !cloudinaryPublicId.startsWith(prefix)) {
        return res.status(400).json({ message: 'Video does not belong to this problem and uploader' });
    }
    try {
        if (!await Problem.findById(problemId)) return res.status(404).json({ message: 'Problem not found' });
        // Retrying metadata after a lost response is safe.
        const existing = await SolutionVideo.findOne({ problemId });
        if (existing) {
            if (existing.cloudinaryPublicId === cloudinaryPublicId) return res.status(200).json(videoReply(existing));
            return res.status(409).json({ message: 'This problem already has a video. Delete it before uploading a replacement.' });
        }
        if (!configured()) return res.status(503).json({ message: 'Video uploads are not configured on the backend' });
        // Admin API responses omit duration unless detailed media metadata is requested.
        const resource = await cloudinary.api.resource(cloudinaryPublicId, {
            resource_type: 'video', media_metadata: true
        });
        if (resource.public_id !== cloudinaryPublicId || resource.resource_type !== 'video' || !resource.secure_url?.startsWith('https://')) {
            return res.status(400).json({ message: 'Cloudinary did not return a valid video' });
        }
        if (!Number.isFinite(resource.duration) || resource.duration < 0) {
            return res.status(503).json({ message: 'Video uploaded, but Cloudinary has not returned its duration yet. Please retry saving in a moment; you do not need to upload again.' });
        }
        const thumbnailUrl = cloudinary.url(resource.public_id, {
            resource_type: 'video', format: 'jpg', secure: true,
            transformation: [{ width: 400, height: 225, crop: 'fill', start_offset: 'auto' }]
        });
        const video = await SolutionVideo.create({ problemId, userId: req.user._id,
            cloudinaryPublicId: resource.public_id, secureUrl: resource.secure_url,
            duration: resource.duration, thumbnailUrl });
        return res.status(201).json(videoReply(video));
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: 'This problem already has a video' });
        return cloudError(res, error, 'Failed to save video metadata. Please retry saving the upload.');
    }
};

function videoReply(video) {
    return { message: 'Video solution saved successfully', videoSolution: {
        id: video._id, secureUrl: video.secureUrl, thumbnailUrl: video.thumbnailUrl,
        duration: video.duration, uploadedAt: video.createdAt
    } };
}

async function removeProblemVideos(problemId) {
    const videos = await SolutionVideo.find({ problemId });
    for (const video of videos) {
        // Keep metadata if Cloudinary deletion fails so the administrator can retry.
        const result = await cloudinary.uploader.destroy(video.cloudinaryPublicId, { resource_type: 'video', invalidate: true });
        if (!['ok', 'not found'].includes(result.result)) throw new Error('Cloudinary could not delete the video');
        await SolutionVideo.deleteOne({ _id: video._id });
    }
    return videos.length;
}

const deleteVideo = async (req, res) => {
    if (!validId(req.params.problemId, res)) return;
    try {
        const removed = await removeProblemVideos(req.params.problemId);
        if (!removed) return res.status(404).json({ message: 'Video not found' });
        return res.json({ message: 'Video deleted successfully' });
    } catch (error) {
        return cloudError(res, error, 'Failed to delete video. Please try again.');
    }
};

module.exports = { generateUploadSignature, saveVideoMetadata, deleteVideo, removeProblemVideos };
