import { useParams } from 'react-router';
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { uploadVideo } from '../utils/uploadVideo';
import { apiErrorMessage } from '../utils/apiErrorMessage';
import axiosClient from '../utils/axiosClient'

const pendingKey = problemId => `pending-video:${problemId}`;
const readPendingUpload = problemId => {
  try {
    const pending = JSON.parse(sessionStorage.getItem(pendingKey(problemId)) || 'null');
    return typeof pending?.public_id === 'string' ? pending : null;
  } catch {
    return null;
  }
};
const rememberPendingUpload = (problemId, asset) => {
  try {
    if (asset) sessionStorage.setItem(pendingKey(problemId), JSON.stringify({ public_id: asset.public_id }));
    else sessionStorage.removeItem(pendingKey(problemId));
  } catch {
    // Saving remains possible in this page when browser storage is unavailable.
  }
};

function AdminUpload(){
    
    const {problemId}  = useParams();
    
    const [pendingUpload, setPendingUpload] = useState(() => readPendingUpload(problemId));
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadedVideo, setUploadedVideo] = useState(null);
    
      const {
        register,
        handleSubmit,
        watch,
        formState: { errors },
        reset,
        setError,
        clearErrors
      } = useForm();
    
      const selectedFile = watch('videoFile')?.[0];
    
      useEffect(() => {
        setPendingUpload(readPendingUpload(problemId));
        setUploadedVideo(null);
        reset();
      }, [problemId, reset]);

      const onSubmit = async (data) => {
        setUploading(true);
        setUploadProgress(pendingUpload ? 100 : 0);
        setUploadedVideo(null);
        clearErrors();
        try {
          let asset = pendingUpload;
          if (!asset) {
            const { data: credentials } = await axiosClient.get(`/video/create/${problemId}`);
            asset = await uploadVideo(data.videoFile[0], credentials, setUploadProgress);
            rememberPendingUpload(problemId, asset);
            setPendingUpload(asset);
          }
          const { data: metadata } = await axiosClient.post('/video/save', {
            problemId, cloudinaryPublicId: asset.public_id
          });
          setUploadedVideo(metadata.videoSolution);
          rememberPendingUpload(problemId, null);
          setPendingUpload(null);
          reset();
        } catch (error) {
          setError('root', { type: 'manual', message: apiErrorMessage(error, error.message || 'Upload failed. Please try again.') });
        } finally {
          setUploading(false);
        }
      };

      // Format file size
      const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };
    
      // Format duration
      const formatDuration = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };
    
      return (
        <div className="max-w-md mx-auto p-6">
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">Upload Video</h2>
              
              <form onSubmit={pendingUpload ? (event) => { event.preventDefault(); if (!uploading) onSubmit({}); } : handleSubmit(onSubmit)} className="space-y-4">
                {/* File Input */}
                <div className="form-control w-full">
                  <label className="label">
                    <span className="label-text">Choose video file</span>
                  </label>
                  <input
                    id="videoFile"
                    type="file"
                    accept="video/*"
                    {...register('videoFile', {
                      required: 'Please select a video file',
                      validate: {
                        isVideo: (files) => {
                          if (!files || !files[0]) return 'Please select a video file';
                          const file = files[0];
                          return file.type.startsWith('video/') || 'Please select a valid video file';
                        },
                        fileSize: (files) => {
                          if (!files || !files[0]) return true;
                          const file = files[0];
                          const maxSize = 100 * 1024 * 1024; // 100MB
                          return file.size <= maxSize || 'File size must be less than 100MB';
                        }
                      }
                    })}
                    className={`file-input file-input-bordered w-full ${errors.videoFile ? 'file-input-error' : ''}`}
                    disabled={uploading || Boolean(pendingUpload)}
                  />
                  {errors.videoFile && (
                    <label className="label">
                      <span className="label-text-alt text-error">{errors.videoFile.message}</span>
                    </label>
                  )}
                </div>
    
                {/* Selected File Info */}
                {selectedFile && (
                  <div className="alert alert-info">
                    <div>
                      <h3 className="font-bold">Selected File:</h3>
                      <p className="text-sm">{selectedFile.name}</p>
                      <p className="text-sm">Size: {formatFileSize(selectedFile.size)}</p>
                    </div>
                  </div>
                )}
    
                {/* Upload Progress */}
                {uploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Uploading...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <progress 
                      className="progress progress-primary w-full" 
                      value={uploadProgress} 
                      max="100"
                    ></progress>
                  </div>
                )}
    
                {pendingUpload && !uploadedVideo && <p className="text-sm">Video uploaded. If saving fails, retry saving without uploading the file again.</p>}
                {/* Error Message */}
                {errors.root && (
                  <div role="alert" className="alert alert-error">
                    <span>{errors.root.message}</span>
                  </div>
                )}
    
                {/* Success Message */}
                {uploadedVideo && (
                  <div role="status" className="alert alert-success">
                    <div>
                      <h3 className="font-bold">Upload Successful!</h3>
                      <p className="text-sm">Duration: {formatDuration(uploadedVideo.duration)}</p>
                      <p className="text-sm">Uploaded: {new Date(uploadedVideo.uploadedAt).toLocaleString()}</p>
                    </div>
                  </div>
                )}
    
                {/* Upload Button */}
                <div className="card-actions justify-end">
                  <button
                    type="submit"
                    disabled={uploading}
                    className={`btn btn-primary ${uploading ? 'loading' : ''}`}
                  >
                    {uploading ? (uploadProgress === 100 ? 'Saving video...' : 'Uploading...') : pendingUpload ? 'Retry Saving Video' : 'Upload Video'}
                  </button>
                </div>
              </form>
            
            </div>
          </div>
        </div>
    );
}


export default AdminUpload;
