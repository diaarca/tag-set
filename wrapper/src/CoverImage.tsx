import { useState } from 'react';

export const songThumbnailURL = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

export function CoverImage(props: {
  src: string;
  alt: string;
  onError: () => void;
  loading?: 'lazy';
}) {
  const [padded, setPadded] = useState(false);
  return (
    <img
      {...props}
      referrerPolicy="no-referrer"
      style={{ transform: padded ? 'scale(1.333333)' : undefined }}
      onLoad={({ currentTarget: image }) => {
        const url = new URL(image.src);
        // YouTube's 4:3 thumbnails contain a letterboxed 16:9 image.
        setPadded(
          ['i.ytimg.com', 'img.youtube.com'].includes(url.hostname) &&
            /\/(?:hqdefault|sddefault|mqdefault|default)\.jpg$/.test(
              url.pathname,
            ) &&
            image.naturalWidth * 3 === image.naturalHeight * 4,
        );
      }}
    />
  );
}

export function TrackCover({ videoId }: { videoId: string }) {
  const [failedVideoId, setFailedVideoId] = useState<string>();
  return (
    <span className="track-cover" aria-hidden="true">
      {failedVideoId === videoId ? (
        '♫'
      ) : (
        <CoverImage
          key={videoId}
          src={songThumbnailURL(videoId)}
          alt=""
          loading="lazy"
          onError={() => setFailedVideoId(videoId)}
        />
      )}
    </span>
  );
}
