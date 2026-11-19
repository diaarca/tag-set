import { useState } from 'react';

export function CoverImage(props: {
  src: string;
  alt: string;
  onError: () => void;
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
