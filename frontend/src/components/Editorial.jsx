import { useState } from 'react';

const Editorial = ({ secureUrl, thumbnailUrl }) => {
  const [failedUrl, setFailedUrl] = useState(null);
  if (!secureUrl) return <p className="text-slate-400">No video editorial has been uploaded for this problem yet.</p>;
  return (
    <div className="w-full max-w-2xl mx-auto rounded-xl overflow-hidden shadow-lg">
      <video key={secureUrl} src={secureUrl} poster={thumbnailUrl} controls playsInline preload="metadata"
        aria-label="Problem video editorial" onError={() => setFailedUrl(secureUrl)}
        className="w-full aspect-video bg-black" />
      {failedUrl === secureUrl && <p role="alert" className="text-error p-3">Unable to load this video. Please try again later.</p>}
    </div>
  );
};

export default Editorial;
