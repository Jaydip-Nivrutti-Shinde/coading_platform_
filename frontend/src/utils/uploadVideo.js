import axios from 'axios';

// Cloudinary requires chunks larger than 5 MB, except for the final chunk.
export async function uploadVideo(file, credentials, onProgress) {
  const chunkSize = 6 * 1024 * 1024;
  const uploadId = crypto.randomUUID();
  let result;
  for (let start = 0; start < file.size; start += chunkSize) {
    const end = Math.min(start + chunkSize, file.size);
    for (let attempt = 0; ; attempt++) {
      const formData = new FormData();
      formData.append('file', file.slice(start, end), file.name);
      for (const key of ['signature', 'timestamp', 'public_id', 'api_key']) formData.append(key, credentials[key]);
      try {
        const response = await axios.post(credentials.upload_url, formData, {
          timeout: 120000,
          headers: { 'X-Unique-Upload-Id': uploadId, 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` },
          onUploadProgress: event => {
            const fraction = event.total ? Math.min(event.loaded / event.total, 1) : 0;
            onProgress(Math.min(99, Math.round((start + (end - start) * fraction) * 100 / file.size)));
          }
        });
        result = response.data;
        break;
      } catch (error) {
        const status = error.response?.status;
        if (attempt >= 2 || (status && status < 500 && status !== 429)) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  if (!result?.public_id || !result?.secure_url || result.done === false) throw new Error('Cloudinary did not finish the video upload. Please retry.');
  onProgress(100);
  return result;
}
